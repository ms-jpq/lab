from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import contextmanager
from functools import cache
from logging import INFO, getLogger
from os import environ, linesep
from typing import TYPE_CHECKING, Any, BinaryIO
from uuid import uuid4

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


@cache
def _s3() -> Any:
    return client(service_name="s3")


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

    def step(
        record: S3EventRecord,
    ) -> None:
        import sieve

        with fetching(msg=record.s3) as fp:
            msg = parse(mail_from=mail_from, fp=fp)
            if sieve.sieve(msg):
                send(
                    sieve=msg,
                    mail_from=mail_from,
                    mail_to=mail_to,
                    mail_srv=mail_srv,
                    mail_user=mail_user,
                    mail_pass=mail_pass,
                    timeout=TIMEOUT,
                )

    def cont() -> Iterator[Exception]:
        with ThreadPoolExecutor() as pool:
            futs = map(lambda x: pool.submit(step, x), event.records)
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
