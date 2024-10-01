from collections.abc import Iterator, Mapping
from dataclasses import dataclass
from email.errors import MultipartInvariantViolationDefect, StartBoundaryNotFoundDefect
from email.message import Message
from email.parser import BytesParser
from email.policy import SMTP, SMTPUTF8
from itertools import chain, takewhile
from logging import getLogger
from smtplib import SMTP_SSL
from string import ascii_letters, digits, whitespace
from sys import stdin
from typing import BinaryIO, Literal


@dataclass(frozen=True)
class _Rewrite:
    act: Literal["noop", "delete", "add", "replace", "ensure"]
    val: str


_LEGAL = frozenset(chain(ascii_letters, digits, whitespace, "@"))
_MISSING_BODY_DEFECTS = (MultipartInvariantViolationDefect, StartBoundaryNotFoundDefect)


def _parse(fp: BinaryIO) -> tuple[Message, bytes]:
    lines = takewhile(lambda x: x != b"\r\n" and x != b"\n", iter(fp.readline, b""))
    headers = b"".join(lines)
    msg = BytesParser(policy=SMTPUTF8).parsebytes(headers)
    body = fp.read()
    return msg, body


def _unparse(msg: Message, body: bytes) -> bytes:
    return msg.as_bytes(policy=SMTP) + body


def _redirect(msg: Message, location: str) -> Iterator[tuple[str, _Rewrite]]:
    quoted = f"<{location}>"
    msg_from = msg.get("from", "")
    mail_from = (
        "".join(ch for ch in msg_from if ch in _LEGAL) + f" {quoted}"
        if msg_from
        else quoted
    )
    mod = {
        "from": _Rewrite(act="ensure", val=mail_from),
        "reply-to": _Rewrite(act="ensure" if msg_from else "noop", val=msg_from),
    }
    for name, spec in mod.items():
        yield name, spec


def _rewrite(msg: Message, headers: Mapping[str, _Rewrite]) -> None:
    for key, rewrite in headers.items():
        match rewrite.act:
            case "noop":
                pass
            case "delete":
                del msg[key]
            case "add":
                msg.add_header(key, rewrite.val)
            case "replace" | "ensure":
                if msg.get(key, "") != "":
                    msg.replace_header(key, rewrite.val)
                elif rewrite.act == "ensure":
                    msg.add_header(key, rewrite.val)
            case _:
                assert False


def redirect(
    mail_from: str,
    mail_to: str,
    mail_srv: str,
    mail_user: str,
    mail_pass: str,
    timeout: float,
    fp: BinaryIO,
) -> Iterator[tuple[Message, bytes]]:
    msg, body = _parse(fp)
    headers = {k: v for k, v in _redirect(msg, location=mail_to)}
    _rewrite(msg, headers=headers)
    mail = _unparse(msg, body)

    for err in msg.defects:
        if not isinstance(err, _MISSING_BODY_DEFECTS):
            getLogger().warning("%s: %s", type(err).__name__, err)
    yield msg, body

    with SMTP_SSL(host=mail_srv, timeout=timeout) as client:
        client.login(mail_user, mail_pass)
        client.sendmail(
            from_addr=mail_from,
            to_addrs=mail_to,
            msg=mail,
        )

        getLogger().info("%s", f" -> {mail_to}")


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
