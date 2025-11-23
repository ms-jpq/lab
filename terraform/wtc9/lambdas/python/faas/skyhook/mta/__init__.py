from collections.abc import Callable, Iterator
from contextlib import closing, contextmanager, nullcontext
from importlib import reload
from io import BytesIO
from logging import getLogger
from os import environ
from pprint import pformat
from smtplib import SMTPDataError
from typing import BinaryIO, cast

from aws_lambda_powertools.utilities.data_classes import S3Event
from aws_lambda_powertools.utilities.data_classes.s3_event import S3Message
from boto3 import client  # pyright:ignore
from botocore.config import Config  # pyright:ignore
from opentelemetry.trace import Span

from ...gist import register, traceback
from .. import TRACER
from .fax import Mail, parse, send

_Sieve = Callable[[Mail], None]

with nullcontext():
    TIMEOUT = 6.9


with nullcontext():
    _S3 = client(service_name="s3", config=Config(retries={"mode": "adaptive"}))


with nullcontext():
    register(name="sieve", uri=environ.get("MAIL_FILT", ""), timeout=TIMEOUT)

    import sieve  # pyright:ignore


@contextmanager
def _fetching(msg: S3Message) -> Iterator[BinaryIO]:
    kw = {"Bucket": msg.bucket.name, "Key": msg.get_object.key}
    rsp = _S3.get_object(**kw)
    yield rsp["Body"]
    _S3.delete_object(**kw)


_cold_start = True


def _load_sieve() -> _Sieve:
    global _cold_start
    with TRACER.start_as_current_span("load sieve"):
        s = sieve if _cold_start else reload(sieve)
        _cold_start = False

    return cast(_Sieve, s.sieve)


def _parse_mail(io: BytesIO) -> Mail:
    with TRACER.start_as_current_span("parse mail") as span:
        mail = parse(io)
        span.add_event("parsed")
        headers = {
            key: (
                "".join(values)
                if len(values := tuple(map(str, mail.headers.get_all(key, "")))) == 1
                else values
            )
            for key in sorted(mail.headers.keys(), key=lambda x: x.casefold())
        }
        span.add_event("parsed.headers", attributes=headers)

    return mail


def proc_mta(event: S3Event) -> None:
    ss = _load_sieve()
    with _fetching(msg=event.record.s3) as fp:
        with closing(fp):
            io = BytesIO(fp.read())

        mail = _parse_mail(io)
        with TRACER.start_as_current_span("run sieve") as span:
            go = False
            try:
                ss(mail)
            except StopAsyncIteration as exn:
                if tb := traceback(sieve, exn=exn):
                    span.add_event("rejected", attributes={"traceback": tb})
            else:
                go = True
                span.add_event("accepted")
            finally:
                span.end()

                if go:
                    with TRACER.start_as_current_span("send") as span:
                        try:
                            send(
                                mail,
                                mail_from=environ["MAIL_FROM"],
                                mail_to=environ["MAIL_TO"],
                                mail_srv=environ["MAIL_SRV"],
                                mail_user=environ["MAIL_USER"],
                                mail_pass=environ["MAIL_PASS"],
                                timeout=TIMEOUT,
                            )
                        except SMTPDataError as e:
                            data = pformat(event._data)
                            span.record_exception(e, attributes={"data": data})
                            getLogger().error("%s", data, exc_info=e)
                            raise e
