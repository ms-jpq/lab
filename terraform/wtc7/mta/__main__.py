from collections.abc import Mapping
from typing import Any, cast

from aws_lambda_powertools import Logger, Metrics, Tracer
from aws_lambda_powertools.utilities.batch import (
    AsyncBatchProcessor,
    EventType,
    async_process_partial_response,
)
from aws_lambda_powertools.utilities.data_classes import SQSEvent, event_source
from aws_lambda_powertools.utilities.data_classes.sqs_event import SQSRecord
from aws_lambda_powertools.utilities.parser.models import SqsRecordModel
from aws_lambda_powertools.utilities.typing import LambdaContext
from boto3 import client

log, metrics, trace = Logger(), Metrics(), Tracer()


@trace.capture_method
async def _run(record: SQSRecord) -> None:
    ses = client(service_name="sesv2")
    data = b""
    # ses.send_email(
    #     FromEmailAddress="",
    #     Destination={"CcAddresses": [""]},
    #     Content={"Raw": {"Data": data}},
    # )
    log.info(record.body)


@metrics.log_metrics
@log.inject_lambda_context
@trace.capture_lambda_handler
@event_source(data_class=SQSEvent)
def main(event: SQSEvent, ctx: LambdaContext) -> Mapping[str, Any]:
    processor = AsyncBatchProcessor(event_type=EventType.SQS, model=SqsRecordModel)
    return async_process_partial_response(
        cast(dict[Any, Any], event),
        context=ctx,
        processor=processor,
        record_handler=_run,
    )
