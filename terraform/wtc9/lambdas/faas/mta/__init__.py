from collections.abc import Callable, Iterator
from concurrent.futures import Executor, ThreadPoolExecutor, as_completed
from contextlib import closing, contextmanager, nullcontext
from importlib import reload
from io import BytesIO
from logging import getLogger
from os import environ, linesep
from pprint import pformat
from smtplib import SMTPDataError
from typing import BinaryIO, cast

from aws_lambda_powertools.utilities.data_classes import S3Event, event_source
from aws_lambda_powertools.utilities.data_classes.s3_event import (
    S3EventRecord,
    S3Message,
)
from aws_lambda_powertools.utilities.typing import LambdaContext
from boto3 import client  # pyright:ignore
from botocore.config import Config  # pyright:ignore
from opentelemetry.instrumentation.aws_lambda import AwsLambdaInstrumentor
from opentelemetry.trace import get_tracer

from .. import _
from ..gist import register, traceback
from ..telemetry import flush_otlp, with_context
from .fax import Mail, parse, send

_Sieve = Callable[[Mail], None]

with nullcontext():
    TIMEOUT = 6.9


with nullcontext():
    _TRACER = get_tracer(__name__)
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


@contextmanager
def _pool() -> Iterator[Executor]:
    pool = ThreadPoolExecutor()
    try:
        yield pool
    finally:
        with _TRACER.start_as_current_span("shutdown"):
            pool.shutdown(wait=True, cancel_futures=True)


_cold_start = True


def _load_sieve() -> _Sieve:
    global _cold_start
    with _TRACER.start_as_current_span("load sieve"):
        s = sieve if _cold_start else reload(sieve)
        _cold_start = False

    return cast(_Sieve, s.sieve)


def _parse_mail(io: BytesIO) -> Mail:
    with _TRACER.start_as_current_span("parse mail") as span:
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


@flush_otlp
@event_source(data_class=S3Event)
def main(event: S3Event, _: LambdaContext) -> None:
    ss = _load_sieve()
    w_ctx = with_context()

    def step(record: S3EventRecord) -> None:
        with w_ctx(), _fetching(msg=record.s3) as fp:
            with closing(fp):
                io = BytesIO(fp.read())

            mail = _parse_mail(io)
            with _TRACER.start_as_current_span("run sieve") as span:
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
                    if go:
                        with _TRACER.start_as_current_span("send") as span:
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
                                data = pformat(record._data)
                                span.add_event("error.data", attributes={"data": data})
                                getLogger().error("%s", data, exc_info=e)
                                raise e

    def cont() -> Iterator[Exception]:
        with _pool() as pool:
            futs = map(lambda x: pool.submit(step, x), event.records)
            for fut in as_completed(futs):
                if exn := fut.exception():
                    if isinstance(exn, Exception):
                        yield exn
                    else:
                        raise exn

    if errs := tuple(cont()):
        err, *__ = errs
        name = linesep.join(f"{type(err)!r} :: {err!r}" for err in errs)
        exn = ExceptionGroup(name, errs)
        getLogger().exception("%s", exn)
        raise exn from err


with nullcontext():
    AwsLambdaInstrumentor().instrument()
