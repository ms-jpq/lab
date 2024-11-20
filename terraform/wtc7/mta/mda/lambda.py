from collections.abc import Iterator
from concurrent.futures import Executor, ThreadPoolExecutor, as_completed
from contextlib import contextmanager
from importlib import reload
from io import BytesIO
from logging import INFO, getLogger
from os import environ, linesep
from typing import BinaryIO

from aws_lambda_powertools.utilities.data_classes import S3Event, event_source
from aws_lambda_powertools.utilities.data_classes.s3_event import (
    S3EventRecord,
    S3Message,
)
from aws_lambda_powertools.utilities.typing import LambdaContext
from boto3 import client  # pyright:ignore

from .fax import parse, send
from .gist import benchmark, log, register

getLogger().setLevel(INFO)


TIMEOUT = 6.9
_M_SRV, _M_FROM, _M_TO, _M_USER, _M_PASS, _M_FILT = (
    environ["MAIL_SRV"],
    environ["MAIL_FROM"],
    environ["MAIL_TO"],
    environ["MAIL_USER"],
    environ["MAIL_PASS"],
    environ["MAIL_FILT"],
)
_S3 = client(service_name="s3")

register(name="sieve", uri=_M_FILT, timeout=TIMEOUT)

import sieve  # pyright:ignore


@contextmanager
def _fetching(msg: S3Message) -> Iterator[BinaryIO]:
    kw = dict(Bucket=msg.bucket.name, Key=msg.get_object.key)
    rsp = _S3.get_object(**kw)
    yield rsp["Body"]
    _S3.delete_object(**kw)


@contextmanager
def _pool() -> Iterator[Executor]:
    pool = ThreadPoolExecutor()
    try:
        yield pool
    finally:
        with benchmark(name="shutdown"):
            pool.shutdown(wait=True, cancel_futures=True)


cold_start = True


@event_source(data_class=S3Event)
def main(event: S3Event, _: LambdaContext) -> None:
    with benchmark(name="main"):
        getLogger().info("%s", ">>> >>> >>>")

        global cold_start
        s = sieve if cold_start else reload(sieve)
        cold_start = False

        def step(record: S3EventRecord) -> None:
            with _fetching(msg=record.s3) as fp:
                with benchmark(name="parse"):
                    io = BytesIO(fp.read())
                    mail = parse(io)
                go = True
                try:
                    ss = s.sieve
                    with benchmark(name="sieve"):
                        ss(mail)
                except StopAsyncIteration as exn:
                    go = False
                    log(mod=sieve, exn=exn)
                finally:
                    if go:
                        with benchmark(name="send"):
                            send(
                                mail,
                                mail_from=_M_FROM,
                                mail_to=_M_TO,
                                mail_srv=_M_SRV,
                                mail_user=_M_USER,
                                mail_pass=_M_PASS,
                                timeout=TIMEOUT,
                            )

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

        getLogger().info("%s", "<<< <<< <<<")
