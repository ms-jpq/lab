from collections.abc import Iterator, Mapping, Set
from dataclasses import dataclass
from email.errors import MultipartInvariantViolationDefect, StartBoundaryNotFoundDefect
from email.message import EmailMessage
from email.parser import BytesParser
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
    act: Literal["noop", "delete", "set-default", "append", "replace", "ensure"]
    val: str


@dataclass(frozen=True)
class _Sieve:
    from_name: str
    m_from: str
    rcpt: str
    cc: Set[str]
    cc_names: Set[str]
    msg: EmailMessage


_NL = SMTP.linesep.encode()
_LS = linesep.encode()
_MISSING_BODY_DEFECTS = (MultipartInvariantViolationDefect, StartBoundaryNotFoundDefect)


def _parse(fp: BinaryIO) -> tuple[EmailMessage, bytes]:
    lines = takewhile(lambda x: x != _NL and x != _LS, iter(fp.readline, b""))
    headers = b"".join(lines)
    msg = BytesParser(policy=SMTPUTF8).parsebytes(headers)
    assert isinstance(msg, EmailMessage)
    body = fp.read()
    return msg, body


def _unparse(msg: EmailMessage, body: bytes) -> bytes:
    head = msg.as_bytes(policy=SMTP)
    assert head.endswith(_NL * 2)
    return head + body


def _redirect(msg: EmailMessage, src: str) -> Iterator[tuple[str, _Rewrite]]:
    msg_from = msg.get("from", "")
    _, x_from = parseaddr(msg_from)
    nxt_from = formataddr((msg_from, src))

    mod = {
        "from": _Rewrite(act="ensure", val=nxt_from),
        "reply-to": (
            _Rewrite(act="set-default", val=x_from)
            if x_from
            else _Rewrite(act="noop", val="")
        ),
        "sender": _Rewrite(act="replace", val=src),
        "return-path": _Rewrite(act="delete", val=""),
    }

    for name, spec in mod.items():
        yield name, spec


def _rewrite(msg: EmailMessage, headers: Mapping[str, _Rewrite]) -> None:
    for key, rewrite in headers.items():
        match rewrite.act:
            case "noop":
                pass
            case "delete":
                del msg[key]
            case "set-default" | "append":
                if not msg.get(key, "") or rewrite.act == "append":
                    msg.add_header(key, rewrite.val)
            case "replace" | "ensure":
                if msg.get(key, "") != "":
                    msg.replace_header(key, rewrite.val)
                elif rewrite.act == "ensure":
                    msg.add_header(key, rewrite.val)
            case _:
                assert False


def _sieve(msg: EmailMessage) -> _Sieve:
    from_name, m_from = parseaddr(msg.get("from", ""))
    _, rcpt = parseaddr(msg.get("to", ""))
    cc_names, cc = tuple(zip(*getaddresses([msg.get("cc", "")]))) or ((), ())
    return _Sieve(
        from_name=from_name,
        m_from=m_from,
        rcpt=rcpt,
        cc=frozenset(cc),
        cc_names=frozenset(cc_names),
        msg=msg,
    )


def redirect(
    mail_from: str,
    mail_to: str,
    mail_srv: str,
    mail_user: str,
    mail_pass: str,
    timeout: float,
    fp: BinaryIO,
) -> Iterator[tuple[_Sieve, bytes]]:
    msg, body = _parse(fp)
    headers = {k: v for k, v in _redirect(msg, src=mail_from)}
    _rewrite(msg, headers=headers)
    sieve = _sieve(msg)
    mail = _unparse(msg, body)

    for err in msg.defects:
        if not isinstance(err, _MISSING_BODY_DEFECTS):
            getLogger().warning("%s: %s", type(err).__name__, err)
    yield sieve, body

    with SMTP_SSL(host=mail_srv, timeout=timeout) as client:
        client.login(mail_user, mail_pass)
        client.sendmail(
            from_addr=mail_from,
            to_addrs=mail_to,
            msg=mail,
        )


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

    for _ in redirect(
        mail_from=args.mail_from,
        mail_to=args.mail_to,
        mail_srv=args.mail_srv,
        mail_user=args.mail_user,
        mail_pass=args.mail_pass,
        timeout=args.timeout,
        fp=stdin.buffer,
    ):
        pass
