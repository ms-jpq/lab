from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from os import environ
from typing import TYPE_CHECKING, BinaryIO

from aws_lambda_powertools.utilities.data_classes import S3Event, event_source
from aws_lambda_powertools.utilities.data_classes.s3_event import (
    S3EventRecord,
    S3Message,
)
from aws_lambda_powertools.utilities.typing import LambdaContext
from boto3 import client

if TYPE_CHECKING:
    from .fax import redirect
    from .sieve import sieve
else:
    from fax import redirect
    from sieve import sieve

TIMEOUT = 6.9

s3 = client(service_name="s3")


@contextmanager
def fetching(msg: S3Message) -> Iterator[BinaryIO]:
    kw = dict(Bucket=msg.bucket.name, Key=msg.get_object.key)
    try:
        rsp = s3.get_object(**kw)
        yield rsp["Body"]
    except Exception:
        raise
    else:
        s3.delete_object(**kw)


@event_source(data_class=S3Event)
def main(event: S3Event, _: LambdaContext) -> None:
    mail_srv, mail_from, mail_to, mail_user, mail_pass = (
        environ["MAIL_SRV"],
        environ["MAIL_FROM"],
        environ["MAIL_TO"],
        environ["MAIL_USER"],
        environ["MAIL_PASS"],
    )

    def step(record: S3EventRecord) -> None:
        with fetching(msg=record.s3) as fp:
            for msg, _ in redirect(
                mail_from=mail_from,
                mail_to=mail_to,
                mail_srv=mail_srv,
                mail_user=mail_user,
                mail_pass=mail_pass,
                timeout=TIMEOUT,
                fp=fp,
            ):
                if not sieve(msg):
                    break

    with ThreadPoolExecutor() as pool:
        tuple(pool.map(step, event.records))
