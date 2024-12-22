from collections.abc import Iterator, Sequence
from dataclasses import dataclass
from email import message_from_bytes
from email.errors import MultipartInvariantViolationDefect, StartBoundaryNotFoundDefect
from email.message import EmailMessage
from email.policy import SMTP, SMTPUTF8
from email.utils import formataddr, getaddresses, parseaddr
from itertools import takewhile
from logging import DEBUG, getLogger
from os import linesep
from smtplib import SMTP_SSL
from sys import stdin
from typing import BinaryIO, Literal


@dataclass(frozen=True)
class _Rewrite:
    act: Literal["noop", "delete", "replace", "append", "set-default", "uniq"]
    val: str


@dataclass
class _Mail:
    headers: EmailMessage
    body: bytes


_NL = SMTP.linesep.encode()
_LS = linesep.encode()
_MISSING_BODY_DEFECTS = (MultipartInvariantViolationDefect, StartBoundaryNotFoundDefect)


def _parse(fp: BinaryIO) -> _Mail:
    lines = takewhile(lambda x: x != _NL and x != _LS, iter(fp.readline, b""))
    headers = b"".join(lines)
    parsed = message_from_bytes(headers, policy=SMTPUTF8) # type: ignore
    assert isinstance(parsed, EmailMessage)
    body = fp.read()
    return _Mail(headers=parsed, body=body)


def parse(fp: BinaryIO) -> _Mail:
    mail = _parse(fp)

    for err in mail.headers.defects:
        if not isinstance(err, _MISSING_BODY_DEFECTS):
            getLogger().warning("%s: %s", type(err).__name__, err)
    return mail


def _unparse(mail: _Mail) -> bytes:
    head = mail.headers.as_bytes(policy=SMTP)
    return head + mail.body


def _redirect(msg: EmailMessage, src: str) -> Iterator[tuple[str, _Rewrite]]:
    msg_from = " ".join(msg.get("from", "").split())
    _, x_from = parseaddr(msg_from)
    nxt_from = formataddr((msg_from, src))

    mod = {
        "from": _Rewrite(act="replace", val=nxt_from),
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

    for name, spec in mod.items():
        yield name, spec


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
    mail: _Mail,
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
        client.sendmail(
            from_addr=mail_from,
            to_addrs=to_addrs,
            msg=msg,
        )
    getLogger().info("%s", f"-->> {to_addrs}")


if __name__ == "__main__":
    from argparse import ArgumentParser, Namespace

    def _parse_args() -> Namespace:
        parser = ArgumentParser()
        parser.add_argument("-f", "--mail-from", required=True)
        parser.add_argument("-t", "--mail-to", required=True)
        parser.add_argument("-s", "--mail-srv", required=True)
        parser.add_argument("-u", "--mail-user", required=True)
        parser.add_argument("-p", "--mail-pass", required=True)
        parser.add_argument("--timeout", type=float, default=5)
        return parser.parse_args()

    args = _parse_args()
    getLogger().setLevel(DEBUG)

    mail = parse(stdin.buffer)
    send(
        mail,
        mail_from=args.mail_from,
        mail_to=args.mail_to,
        mail_srv=args.mail_srv,
        mail_user=args.mail_user,
        mail_pass=args.mail_pass,
        timeout=args.timeout,
    )
