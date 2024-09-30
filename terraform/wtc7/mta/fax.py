from collections.abc import Sequence
from email.errors import MessageDefect
from email.message import Message
from email.parser import BytesParser
from email.policy import SMTP, SMTPUTF8
from itertools import takewhile
from os import getuid, linesep
from pwd import getpwuid
from smtplib import SMTP_SSL
from socket import getfqdn
from sys import stderr, stdin, stdout
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
    header = "from"
    if msg.get(header, "") != "":
        msg.replace_header(header, redirect)
    else:
        msg.add_header(header, redirect)


def redirect(
    mail_from: str,
    mail_to: str,
    mail_srv: str,
    timeout: float,
    fp: BinaryIO,
) -> Sequence[MessageDefect]:
    msg, body = _parse(fp)
    _rewrite(msg, redirect=mail_from)
    mail = _unparse(msg, body)

    with SMTP_SSL(host=mail_srv, timeout=timeout) as client:
        client.sendmail(
            from_addr=mail_from,
            to_addrs=mail_to,
            msg=mail,
        )

    return msg.defects


if __name__ == "__main__":
    user = getpwuid(getuid()).pw_name
    localhost = getfqdn()

    msg, _ = _parse(stdin.buffer)
    _rewrite(msg, redirect=f"{user}@{localhost}")

    stdout.writelines((str(msg), linesep))
    stdout.flush()
    stderr.writelines(map(str, msg.defects))
