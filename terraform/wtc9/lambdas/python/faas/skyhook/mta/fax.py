from collections.abc import Iterator, Sequence
from contextlib import suppress
from dataclasses import dataclass
from email import message_from_bytes
from email.errors import (
    HeaderParseError,
    MultipartInvariantViolationDefect,
    StartBoundaryNotFoundDefect,
)
from email.header import decode_header
from email.message import EmailMessage
from email.policy import SMTP, SMTPUTF8
from email.utils import formataddr, getaddresses, parseaddr, unquote
from itertools import islice, takewhile
from logging import getLogger
from os import linesep
from smtplib import SMTP_SSL
from typing import BinaryIO, Literal

from opentelemetry.trace import get_current_span


@dataclass(frozen=True)
class _Rewrite:
    act: Literal["noop", "delete", "replace", "append", "set-default", "uniq"]
    val: str


@dataclass
class Mail:
    headers: EmailMessage
    body: bytes


_NL = SMTP.linesep.encode()
_LS = linesep.encode()
_MISSING_BODY_DEFECTS = (MultipartInvariantViolationDefect, StartBoundaryNotFoundDefect)


def _parse(fp: BinaryIO) -> Mail:
    lines = takewhile(lambda x: x not in {_NL, _LS}, iter(fp.readline, b""))
    headers = b"".join(lines)
    parsed = message_from_bytes(headers, policy=SMTPUTF8)
    assert isinstance(parsed, EmailMessage)
    body = fp.read()
    return Mail(headers=parsed, body=body)


def parse(fp: BinaryIO) -> Mail:
    mail = _parse(fp)

    for err in mail.headers.defects:
        if not isinstance(err, _MISSING_BODY_DEFECTS):
            get_current_span().add_event(
                "found.defect", attributes={type(err).__name__: str(err)}
            )
            getLogger().warning("%s: %s", type(err).__name__, err)

    return mail


def _unparse(mail: Mail) -> bytes:
    head = mail.headers.as_bytes(policy=SMTP)
    return head + mail.body


def _decode(name: str) -> Iterator[str]:
    with suppress(HeaderParseError):
        for lhs, rhs in decode_header(name):
            if isinstance(lhs, bytes) and isinstance(rhs, str):
                yield lhs.decode(rhs, errors="backslashreplace")
            elif isinstance(lhs, str):
                yield lhs
            else:
                assert False, (lhs, rhs)


def _get_addrs(msg: EmailMessage, header: str, max_addrs: int = 44) -> str:
    sliced = islice(map(formataddr, getaddresses(msg.get_all(header, []))), max_addrs)
    return ",".join(sliced)


def _redirect(msg: EmailMessage, src: str) -> Iterator[tuple[str, _Rewrite]]:
    raw_name, x_from = parseaddr(" ".join(msg.get("from", "").split()))
    nxt_to, nxt_cc = _get_addrs(msg, header="to"), _get_addrs(msg, header="cc")

    name = " ".join(_decode(unquote(raw_name)))
    new_name = f'{name} faxed-by "{x_from}"'
    nxt_from = formataddr((new_name, src))

    mod = {
        "from": _Rewrite(act="replace", val=nxt_from),
        "to": _Rewrite(act="replace", val=nxt_to or nxt_cc or "root@localhost"),
        "cc": _Rewrite(act="replace", val=nxt_cc),
        "reply-to": (
            _Rewrite(act="set-default", val=x_from)
            if x_from
            else _Rewrite(act="noop", val="")
        ),
        "sender": _Rewrite(act="delete", val=src),
        "return-path": _Rewrite(act="delete", val=""),
        "delivered-to": _Rewrite(act="uniq", val=""),
        "dkim-signature": _Rewrite(act="uniq", val=""),
        "message-id": _Rewrite(act="uniq", val=""),
    }

    yield from mod.items()


def _rewrite(msg: EmailMessage, rewrites: Iterator[tuple[str, _Rewrite]]) -> None:
    for key, rewrite in rewrites:
        match rewrite.act:
            case "noop":
                pass
            case "delete":
                del msg[key]
            case "replace":
                del msg[key]
                msg.add_header(key, rewrite.val)
            case "append":
                msg.add_header(key, rewrite.val)
            case "set-default":
                if key not in msg:
                    msg.add_header(key, rewrite.val)
            case "uniq":
                if hdrs := msg.get_all(key):
                    *_, hdr = hdrs
                    del msg[key]
                    msg.add_header(key, hdr)
            case _:
                assert False


def _parse_addrs(addrs: str) -> Sequence[str]:
    _, to_addrs = tuple(zip(*getaddresses([addrs]))) or ((), ())
    return to_addrs


def send(
    mail: Mail,
    mail_from: str,
    mail_to: str,
    mail_srv: str,
    mail_user: str,
    mail_pass: str,
    timeout: float,
) -> None:
    rewrites = _redirect(mail.headers, src=mail_from)
    _rewrite(mail.headers, rewrites=rewrites)
    to_addrs = _parse_addrs(mail_to)
    msg = _unparse(mail)
    with SMTP_SSL(host=mail_srv, timeout=timeout) as client:
        client.login(mail_user, mail_pass)
        client.sendmail(from_addr=mail_from, to_addrs=to_addrs, msg=msg)
    getLogger().info("%s", f"-->> {to_addrs}")
