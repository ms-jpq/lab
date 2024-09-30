from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from email import message_from_string
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from sys import stderr
from typing import Any, cast

from aws_lambda_powertools import Logger, Metrics, Tracer
from aws_lambda_powertools.utilities.batch import (
    AsyncBatchProcessor,
    EventType,
    async_process_partial_response,
)
from aws_lambda_powertools.utilities.batch.types import PartialItemFailureResponse
from aws_lambda_powertools.utilities.data_classes import SQSEvent, event_source
from aws_lambda_powertools.utilities.data_classes.sqs_event import SQSRecord
from aws_lambda_powertools.utilities.parser.models import SqsRecordModel
from aws_lambda_powertools.utilities.typing import LambdaContext
from boto3 import client

log, metrics, trace = Logger(stream=stderr), Metrics(), Tracer()
ses, s3 = client(service_name="sesv2"), client(service_name="s3")


def mail() -> None:
    body_text = ""
    # Create a MIME container.
    msg = MIMEMultipart()
    # Create a MIME text part.
    text_part = MIMEText(body_text, _subtype="html")
    # Attach the text part to the MIME message.
    msg.attach(text_part)


@asynccontextmanager
async def fetching(bucket: str, key: str) -> AsyncIterator[bytes]:
    kw = dict(Bucket=bucket, Key=key)
    try:
        rsp = s3.get_object(**kw)
        yield rsp["Body"]
    except Exception:
        raise
    else:
        s3.delete_object(**kw)


@trace.capture_method
async def _run(record: SQSRecord) -> None:
    ev = record.decoded_nested_s3_event
    bucket, key = ev.bucket_name, ev.object_key
    async with fetching(bucket, key=key) as raw:
        # ses.send_email(
        #     FromEmailAddress="",
        #     Destination={"CcAddresses": [""]},
        #     Content={"Raw": {"Data": data}},
        # )
        log.info(record)


@metrics.log_metrics
@log.inject_lambda_context
@trace.capture_lambda_handler
@event_source(data_class=SQSEvent)
def main(event: SQSEvent, ctx: LambdaContext) -> PartialItemFailureResponse:
    processor = AsyncBatchProcessor(event_type=EventType.SQS, model=SqsRecordModel)
    return async_process_partial_response(
        cast(dict[Any, Any], event),
        context=ctx,
        processor=processor,
        record_handler=_run,
    )
