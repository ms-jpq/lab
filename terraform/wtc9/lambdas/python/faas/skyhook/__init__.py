from contextlib import nullcontext

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
from opentelemetry.context import Context, get_current
from opentelemetry.propagate import extract
from opentelemetry.trace import get_tracer
from opentelemetry.trace.status import StatusCode

from .. import _
from ..telemetry import add_mutual_links, entry, with_context

with nullcontext():
    TRACER = get_tracer(__name__)

from .mta import proc_mta
from .twilio import proc_twilio

with nullcontext():
    _PROC = BatchProcessor(
        raise_on_entire_batch_failure=False, event_type=EventType.SQS
    )


def _context(record: SQSRecord) -> Context | None:
    if not (parent := record.message_attributes["TraceParent"]):
        return get_current()

    carrier = {"traceparent": parent.string_value}
    return extract(carrier)


def _handler(record: SQSRecord) -> None:
    with TRACER.start_as_current_span(
        "process record", attributes=record.attributes.raw_event
    ) as rs:
        if not record.message_attributes:
            with TRACER.start_as_current_span("mta"):
                proc_mta(event=record.decoded_nested_s3_event)
        else:
            ctx = _context(record)
            with TRACER.start_as_current_span("webhook", context=ctx) as s:
                add_mutual_links(rs, s)
                ok = proc_twilio(record)
                s.set_status(StatusCode.OK if ok else StatusCode.ERROR)


@event_source(data_class=SQSEvent)
@entry()
def main(event: SQSEvent, ctx: LambdaContext) -> PartialItemFailureResponse:
    context = get_current()
    proc = with_context(context)(_handler)
    return process_partial_response(
        processor=_PROC,
        event=event.raw_event,
        context=ctx,
        record_handler=proc,
    )
