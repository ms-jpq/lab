from concurrent.futures import ThreadPoolExecutor
from contextlib import nullcontext

from aws_lambda_powertools.utilities.batch.types import (
    PartialItemFailureResponse,
    PartialItemFailures,
)
from aws_lambda_powertools.utilities.data_classes import (
    SQSEvent,
    SQSRecord,
    event_source,
)
from aws_lambda_powertools.utilities.typing import LambdaContext
from opentelemetry.context import Context, get_current
from opentelemetry.propagate import extract
from opentelemetry.trace import SpanKind, get_tracer
from opentelemetry.trace.status import StatusCode

from .. import _, report_exception
from ..telemetry import add_mutual_links, entry, with_context

with nullcontext():
    TRACER = get_tracer(__name__)

from .mta import Sieve, load_sieve, proc_mta
from .twilio import proc_twilio


def _context(record: SQSRecord) -> Context | None:
    if not (parent := record.message_attributes["TraceParent"]):
        return get_current()

    carrier = {"traceparent": parent.string_value}
    return extract(carrier)


@report_exception()
def _handler(ss: Sieve, record: SQSRecord) -> None:
    with TRACER.start_as_current_span(
        "process record", attributes=record.attributes.raw_event
    ) as rs:
        if not record.message_attributes:
            with TRACER.start_as_current_span("mta"):
                proc_mta(ss, event=record.decoded_nested_s3_event)
        else:
            ctx = _context(record)
            with TRACER.start_as_current_span("twilio error", context=ctx) as s:
                add_mutual_links(rs, s)
                ok = proc_twilio(record)
                s.set_status(StatusCode.OK if ok else StatusCode.ERROR)


@event_source(data_class=SQSEvent)
@entry(kind=SpanKind.CONSUMER)
def main(event: SQSEvent, ctx: LambdaContext) -> PartialItemFailureResponse:
    context, ss = get_current(), load_sieve()

    @with_context(context)
    def cont(record: SQSRecord) -> PartialItemFailures | None:
        try:
            _handler(ss, record=record)
        except Exception:
            return {"itemIdentifier": record.message_id}
        else:
            return None

    with ThreadPoolExecutor() as ex:
        mapped = ex.map(cont, event.records)

    return {"batchItemFailures": [m for m in mapped if m]}
