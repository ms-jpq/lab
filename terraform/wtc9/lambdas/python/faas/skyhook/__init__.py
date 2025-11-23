from contextlib import nullcontext
from functools import partial

from aws_lambda_powertools.utilities.batch import (
    BatchProcessor,
    EventType,
    process_partial_response,
)
from aws_lambda_powertools.utilities.batch.types import PartialItemFailureResponse
from aws_lambda_powertools.utilities.data_classes import (
    SQSEvent,
    SQSRecord,
    event_source,
)
from aws_lambda_powertools.utilities.typing import LambdaContext
from opentelemetry.context import get_current
from opentelemetry.trace import Span, get_current_span, get_tracer

from .. import _
from ..telemetry import entry, with_context

with nullcontext():
    TRACER = get_tracer(__name__)

from .mta import proc_mta
from .twilio import proc_twilio

with nullcontext():
    _PROC = BatchProcessor(event_type=EventType.SQS)


def _handler(span: Span, record: SQSRecord) -> None:
    match record.event_source:
        case "aws:s3s":
            pass
            proc_mta(span, event=record.decoded_nested_s3_event)
        case "aws:sqs":
            proc_twilio(span, record=record)
        case _:
            assert False, record.raw_event


@event_source(data_class=SQSEvent)
@entry()
def main(event: SQSEvent, ctx: LambdaContext) -> PartialItemFailureResponse:
    context, span = get_current(), get_current_span()
    proc = with_context(context)(partial(_handler, span))
    return process_partial_response(
        processor=_PROC,
        event=event.raw_event,
        context=ctx,
        record_handler=proc,
    )
