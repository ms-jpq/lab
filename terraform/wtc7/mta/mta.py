from collections.abc import Iterator
from contextlib import contextmanager
from os import environ
from sys import stderr
from typing import TYPE_CHECKING, Any, BinaryIO, cast

from aws_lambda_powertools import Logger, Metrics, Tracer
from aws_lambda_powertools.utilities.batch import (
    BatchProcessor,
    EventType,
    process_partial_response,
)
from aws_lambda_powertools.utilities.batch.types import PartialItemFailureResponse
from aws_lambda_powertools.utilities.data_classes import S3Event, event_source
from aws_lambda_powertools.utilities.data_classes.s3_event import (
    S3EventRecord,
    S3Message,
)
from aws_lambda_powertools.utilities.typing import LambdaContext
from boto3 import client

if TYPE_CHECKING:
    from .fax import redirect
else:
    from fax import redirect

TIMEOUT = 6.9

log = Logger(stream=stderr)
metrics = Metrics()
trace = Tracer()

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


@metrics.log_metrics
@log.inject_lambda_context
@trace.capture_lambda_handler
@event_source(data_class=S3Event)
def main(event: S3Event, ctx: LambdaContext) -> PartialItemFailureResponse:
    mail_srv, mail_from, mail_to, mail_user, mail_pass = (
        environ["MAIL_SRV"],
        environ["MAIL_FROM"],
        environ["MAIL_TO"],
        environ["MAIL_USER"],
        environ["MAIL_PASS"],
    )

    @trace.capture_method
    def _run(record: S3EventRecord) -> None:
        with fetching(msg=record.s3) as fp:
            errs = redirect(
                mail_from=mail_from,
                mail_to=mail_to,
                mail_srv=mail_srv,
                mail_user=mail_user,
                mail_pass=mail_pass,
                timeout=TIMEOUT,
                fp=fp,
            )
            for err in errs:
                log.error(err)

    return process_partial_response(
        cast(dict[Any, Any], event),
        context=ctx,
        processor=BatchProcessor(event_type=EventType.SQS),
        record_handler=_run,
    )
