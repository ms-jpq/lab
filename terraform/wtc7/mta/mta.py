from collections.abc import Iterator
from contextlib import contextmanager
from os import environ
from sys import stderr
from typing import Any, BinaryIO, cast

from aws_lambda_powertools import Logger, Metrics, Tracer
from aws_lambda_powertools.utilities.batch import (
    BatchProcessor,
    EventType,
    process_partial_response,
)
from aws_lambda_powertools.utilities.batch.types import PartialItemFailureResponse
from aws_lambda_powertools.utilities.data_classes import SQSEvent, event_source
from aws_lambda_powertools.utilities.data_classes.sqs_event import SQSRecord
from aws_lambda_powertools.utilities.parser.models import SqsRecordModel
from aws_lambda_powertools.utilities.typing import LambdaContext
from boto3 import client

from .__main__ import redirect

TIMEOUT = 6.9

log = Logger(stream=stderr)
metrics = Metrics()
trace = Tracer()

s3 = client(service_name="s3")


@contextmanager
def fetching(bucket: str, key: str) -> Iterator[BinaryIO]:
    kw = dict(Bucket=bucket, Key=key)
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
@event_source(data_class=SQSEvent)
def main(event: SQSEvent, ctx: LambdaContext) -> PartialItemFailureResponse:
    processor = BatchProcessor(event_type=EventType.SQS, model=SqsRecordModel)

    mail_srv, mail_from, mail_to = (
        environ["MAIL_SRV"],
        environ["MAIL_FROM"],
        environ["MAIL_TO"],
    )

    @trace.capture_method
    def _run(record: SQSRecord) -> None:
        ev = record.decoded_nested_s3_event
        bucket, key = ev.bucket_name, ev.object_key
        with fetching(bucket, key=key) as fp:
            redirect(
                mail_from=mail_from,
                mail_to=mail_to,
                mail_srv=mail_srv,
                timeout=TIMEOUT,
                fp=fp,
            )

    return process_partial_response(
        cast(dict[Any, Any], event),
        context=ctx,
        processor=processor,
        record_handler=_run,
    )
