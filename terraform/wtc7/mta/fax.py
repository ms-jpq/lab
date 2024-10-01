from argparse import ArgumentParser, Namespace
from collections.abc import Sequence
from email.errors import MessageDefect
from email.message import Message
from email.parser import BytesParser
from email.policy import SMTP, SMTPUTF8
from itertools import takewhile
from smtplib import SMTP_SSL
from sys import stdin
from typing import BinaryIO


def _parse(fp: BinaryIO) -> tuple[Message, bytes]:
    lines = takewhile(lambda x: x != b"\r\n" and x != b"\n", iter(fp.readline, b""))
    headers = b"".join(lines)
    msg = BytesParser(policy=SMTPUTF8).parsebytes(headers)
    body = fp.read()
    return msg, body


def _unparse(msg: Message, body: bytes) -> bytes:
    return msg.as_bytes(policy=SMTP) + body


def _rewrite(msg: Message, redirect: str) -> None:
    mod = {
        "from": (True, redirect),
        "return-path": (False, redirect),
        "sender": (False, redirect),
    }
    for key, (required, val) in mod.items():
        if msg.get(key, "") != "":
            msg.replace_header(key, val)
        elif required:
            msg.add_header(key, val)


def redirect(
    mail_from: str,
    mail_to: str,
    mail_srv: str,
    mail_user: str,
    mail_pass: str,
    timeout: float,
    fp: BinaryIO,
) -> Sequence[MessageDefect]:
    msg, body = _parse(fp)
    _rewrite(msg, redirect=mail_from)
    mail = _unparse(msg, body)

    with SMTP_SSL(host=mail_srv, timeout=timeout) as client:
        client.login(mail_user, mail_pass)
        client.sendmail(
            from_addr=mail_from,
            to_addrs=mail_to,
            msg=mail,
        )

    return msg.defects


def _parse_args() -> Namespace:
    parser = ArgumentParser()
    parser.add_argument("--mail-from", required=True)
    parser.add_argument("--mail-to", required=True)
    parser.add_argument("--mail-srv", required=True)
    parser.add_argument("--mail-user", required=True)
    parser.add_argument("--mail-pass", required=True)
    parser.add_argument("--timeout", type=float, default=5)
    return parser.parse_args()


if __name__ == "__main__":
    args = _parse_args()
    msg, _ = _parse(stdin.buffer)

    errs = redirect(
        mail_from=args.mail_from,
        mail_to=args.mail_to,
        mail_srv=args.mail_srv,
        mail_user=args.mail_user,
        mail_pass=args.mail_pass,
        timeout=args.timeout,
        fp=stdin.buffer,
    )
    for err in errs:
        print(err)
