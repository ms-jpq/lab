from sys import stderr

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


@trace.capture_method
async def _run(record: SQSRecord) -> None:
    data = b""
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
    ev = {**event, "Records": [*event.records]}
    return async_process_partial_response(
        ev,
        context=ctx,
        processor=processor,
        record_handler=_run,
    )
