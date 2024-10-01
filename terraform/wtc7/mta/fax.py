from collections.abc import Iterator, Mapping
from email.message import Message
from email.parser import BytesParser
from email.policy import SMTP, SMTPUTF8
from itertools import takewhile
from logging import getLogger
from re import compile
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


def _redirect(msg: Message, location: str) -> Iterator[tuple[str, tuple[bool, str]]]:
    re = compile(r"<([^>]+)>")
    quoted = f"<{location}>"
    mod = {
        "from": (True, True),
        "return-path": (False, True),
        "sender": (False, False),
    }
    for name, (required, x_fwd) in mod.items():
        if (val := msg.get(name, "")) and x_fwd:
            stripped = re.sub(lambda x: x.group(1), val)
            val = f"{stripped} VIA {quoted}"
        elif required:
            val = quoted
        if val:
            yield name, (required, val)


def _rewrite(msg: Message, headers: Mapping[str, tuple[bool, str]]) -> None:
    for key, (required, val) in headers.items():
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
) -> Iterator[tuple[Message, bytes]]:
    msg, body = _parse(fp)
    headers = {k: v for k, v in _redirect(msg, location=mail_to)}
    _rewrite(msg, headers=headers)
    mail = _unparse(msg, body)

    for err in msg.defects:
        getLogger().warning("%s: %s", type(err).__name__, err)
    yield msg, body

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
