from logging import INFO, getLogger

getLogger().setLevel(INFO)
getLogger().info("%s", ">>> >>> >>>")


from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import contextmanager
from functools import cache
from importlib import reload
from os import environ, linesep
from typing import TYPE_CHECKING, Any, BinaryIO

from aws_lambda_powertools.utilities.data_classes import S3Event, event_source
from aws_lambda_powertools.utilities.data_classes.s3_event import (
    S3EventRecord,
    S3Message,
)
from aws_lambda_powertools.utilities.typing import LambdaContext
from boto3 import client

if TYPE_CHECKING:
    from .fax import parse, send
    from .gist import register
else:
    from fax import parse, send
    from gist import register

TIMEOUT = 6.9
_POOL = ThreadPoolExecutor()
_M_SRV, _M_FROM, _M_TO, _M_USER, _M_PASS, _M_FILT = (
    environ["MAIL_SRV"],
    environ["MAIL_FROM"],
    environ["MAIL_TO"],
    environ["MAIL_USER"],
    environ["MAIL_PASS"],
    environ["MAIL_FILT"],
)

register(name="sieve", uri=_M_FILT, timeout=TIMEOUT)
getLogger().info("%s", "=== === ===")

import sieve


@cache
def _s3() -> Any:
    return client(service_name="s3")


@contextmanager
def fetching(msg: S3Message) -> Iterator[BinaryIO]:
    kw = dict(Bucket=msg.bucket.name, Key=msg.get_object.key)
    rsp = _s3().get_object(**kw)
    yield rsp["Body"]
    _s3().delete_object(**kw)


cold_start = True


@event_source(data_class=S3Event)
def main(event: S3Event, _: LambdaContext) -> None:
    global cold_start
    s = sieve if cold_start else reload(sieve)
    cold_start = False

    def step(record: S3EventRecord) -> None:
        with fetching(msg=record.s3) as fp:
            msg = parse(mail_from=_M_FROM, fp=fp)
            go = True
            try:
                go = s.sieve(msg)
            finally:
                if go:
                    send(
                        sieve=msg,
                        mail_from=_M_FROM,
                        mail_to=_M_TO,
                        mail_srv=_M_SRV,
                        mail_user=_M_USER,
                        mail_pass=_M_PASS,
                        timeout=TIMEOUT,
                    )

    def cont() -> Iterator[Exception]:
        futs = map(lambda x: _POOL.submit(step, x), event.records)
        for fut in as_completed(futs):
            if exn := fut.exception():
                if isinstance(exn, Exception):
                    yield exn
                else:
                    raise exn

    if errs := tuple(cont()):
        name = linesep.join(map(str, errs))
        try:
            raise ExceptionGroup(name, errs) from errs[0]
        except Exception as e:
            getLogger().exception("%s", e)
            raise

    getLogger().info("%s", "<<< <<< <<<")
