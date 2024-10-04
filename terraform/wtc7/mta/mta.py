from collections.abc import Callable, Iterator
from concurrent.futures import Future, ThreadPoolExecutor, as_completed
from contextlib import contextmanager
from datetime import datetime
from functools import cache
from logging import INFO, getLogger
from os import environ, linesep
from typing import TYPE_CHECKING, Any, BinaryIO, cast
from uuid import uuid4

from aws_lambda_powertools.utilities.data_classes import S3Event, event_source
from aws_lambda_powertools.utilities.data_classes.s3_event import (
    S3EventRecord,
    S3Message,
)
from aws_lambda_powertools.utilities.typing import LambdaContext
from boto3 import client

if TYPE_CHECKING:
    from .fax import parse, parse_addrs, unparse
    from .gist import register
else:
    from fax import parse, parse_addrs, unparse
    from gist import register


_Sieve = Callable[[Any], bool]

TIMEOUT = 6.9


@cache
def _s3() -> Any:
    return client(service_name="s3")


@cache
def _ses() -> Any:
    return client(service_name="sesv2")


@contextmanager
def fetching(msg: S3Message) -> Iterator[BinaryIO]:
    kw = dict(Bucket=msg.bucket.name, Key=msg.get_object.key)
    rsp = _s3().get_object(**kw)
    yield rsp["Body"]
    _s3().delete_object(**kw)


@event_source(data_class=S3Event)
def main(event: S3Event, _: LambdaContext) -> None:
    getLogger().setLevel(INFO)

    mail_srv, mail_from, mail_to, mail_user, mail_pass, mail_filter = (
        environ["MAIL_SRV"],
        environ["MAIL_FROM"],
        environ["MAIL_TO"],
        environ["MAIL_USER"],
        environ["MAIL_PASS"],
        environ["MAIL_FILT"],
    )
    uri = f"{mail_filter}?{uuid4()}={uuid4()}"
    register(name="sieve", uri=uri, retries=3, timeout=TIMEOUT)

    def _sieve() -> _Sieve:
        from sieve import sieve

        return cast(_Sieve, sieve)

    def step(record: S3EventRecord, fut: Future[_Sieve]) -> None:
        with fetching(msg=record.s3) as fp:
            sieve = parse(mail_from=mail_from, fp=fp)
            flt = fut.result()
            if flt(sieve):
                to_addrs = parse_addrs(mail_to)
                raw = unparse(sieve)
                _ses().send_email(
                    FromEmailAddress=mail_from,
                    Destination={"ToAddresses": to_addrs},
                    Content={"Raw": {"Data": raw}},
                )

    def cont() -> Iterator[Exception]:
        with ThreadPoolExecutor() as pool:
            f = pool.submit(_sieve)
            futs = map(lambda x: pool.submit(step, x, f), event.records)
            for fut in as_completed(futs):
                if exn := fut.exception():
                    if isinstance(exn, Exception):
                        yield exn
                    else:
                        raise exn

        getLogger().info("%s", ">>> >>> >>>")

    if errs := tuple(cont()):
        name = linesep.join(map(str, errs))
        try:
            raise ExceptionGroup(name, errs) from errs[0]
        except Exception as e:
            getLogger().exception("%s", e)
            raise
