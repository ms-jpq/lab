from collections.abc import Iterator
from concurrent.futures import Executor, ThreadPoolExecutor, as_completed
from contextlib import contextmanager, nullcontext
from importlib import reload
from io import BytesIO
from logging import getLogger
from os import environ, linesep
from pprint import pformat
from smtplib import SMTPDataError
from typing import BinaryIO

from aws_lambda_powertools.utilities.data_classes import S3Event, event_source
from aws_lambda_powertools.utilities.data_classes.s3_event import (
    S3EventRecord,
    S3Message,
)
from aws_lambda_powertools.utilities.typing import LambdaContext
from boto3 import client  # pyright:ignore
from botocore.config import Config  # pyright:ignore
from opentelemetry.context import get_current
from opentelemetry.instrumentation.aws_lambda import AwsLambdaInstrumentor

from .tel import __, with_context

assert __

from .__main__ import parse, send
from .gist import TRACER, log, register

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


@contextmanager
def _pool() -> Iterator[Executor]:
    pool = ThreadPoolExecutor()
    try:
        yield pool
    finally:
        with TRACER.start_as_current_span("shutdown"):
            pool.shutdown(wait=True, cancel_futures=True)


_cold_start = True


@event_source(data_class=S3Event)
def main(event: S3Event, _: LambdaContext) -> None:
    global _cold_start

    s = sieve if _cold_start else reload(sieve)
    _cold_start = False
    ctx = get_current()

    def step(record: S3EventRecord) -> None:
        with with_context(ctx), _fetching(msg=record.s3) as fp:
            with TRACER.start_as_current_span("parse"):
                io = BytesIO(fp.read())
                mail = parse(io)
            go = True
            with TRACER.start_as_current_span("sieve"):
                try:
                    ss = s.sieve
                    ss(mail)
                except StopAsyncIteration as exn:
                    go = False
                    log(mod=sieve, exn=exn)

            if go:
                with TRACER.start_as_current_span("send"):
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


AwsLambdaInstrumentor().instrument()
