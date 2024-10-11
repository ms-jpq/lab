from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import contextmanager
from importlib import reload
from io import BytesIO
from logging import INFO, getLogger
from os import environ, linesep
from typing import TYPE_CHECKING, BinaryIO

from aws_lambda_powertools.utilities.data_classes import S3Event, event_source
from aws_lambda_powertools.utilities.data_classes.s3_event import (
    S3EventRecord,
    S3Message,
)
from aws_lambda_powertools.utilities.typing import LambdaContext
from boto3 import client

getLogger().setLevel(INFO)

if TYPE_CHECKING:
    from .fax import parse, send
    from .gist import benchmark, register
else:
    from fax import parse, send
    from gist import benchmark, register

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

import sieve


@contextmanager
def fetching(msg: S3Message) -> Iterator[BinaryIO]:
    kw = dict(Bucket=msg.bucket.name, Key=msg.get_object.key)
    rsp = _S3.get_object(**kw)
    yield rsp["Body"]
    _S3.delete_object(**kw)


cold_start = True


@event_source(data_class=S3Event)
def main(event: S3Event, _: LambdaContext) -> None:
    with benchmark(name="main"):
        getLogger().info("%s", ">>> >>> >>>")

        global cold_start
        s = sieve if cold_start else reload(sieve)
        cold_start = False

        def step(record: S3EventRecord) -> None:
            with fetching(msg=record.s3) as fp:
                with benchmark(name="parse"):
                    io = BytesIO(fp.read())
                    mail = parse(io)
                go = True
                try:
                    with benchmark(name="sieve"):
                        go = s.sieve(mail)
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
            pool = ThreadPoolExecutor()
            try:
                futs = map(lambda x: pool.submit(step, x), event.records)
                for fut in as_completed(futs):
                    if exn := fut.exception():
                        if isinstance(exn, Exception):
                            yield exn
                        else:
                            raise exn
            finally:
                pool.shutdown(wait=False, cancel_futures=True)

        if errs := tuple(cont()):
            name = linesep.join(map(str, errs))
            raise ExceptionGroup(name, errs) from errs[0]

        getLogger().info("%s", "<<< <<< <<<")
