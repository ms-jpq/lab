from contextlib import nullcontext
from functools import cache
from hashlib import sha1
from json import loads
from os import environ

from aws_lambda_powertools.utilities.data_classes import SQSRecord
from boto3 import client
from opentelemetry.context import Context
from opentelemetry.propagate import extract
from opentelemetry.trace import Span
from opentelemetry.trace.status import StatusCode

from ... import B3_CONF, _, dump_json
from ...twilio import parse_params, verify
from .. import TRACER

with nullcontext():
    _sns = client(service_name="sns", config=B3_CONF)


@cache
def _channel() -> str:
    return environ["ENV_CHAN_NAME"]


def _context(record: SQSRecord) -> Context | None:
    if not (parent := record.message_attributes["TraceParent"]):
        return None

    carrier = {"traceparent": parent.string_value}
    return extract(carrier)


def _proc(record: SQSRecord) -> bool:
    match record.raw_event:
        case {
            "messageAttributes": {
                "RawURL": {"stringValue": str(uri)},
                "Signature": {"stringValue": str(signature)},
            }
        }:
            params = parse_params(record.body)
        case _:
            return False

    with TRACER.start_as_current_span("verify hmac"):
        if not verify(uri, params=params, signature=signature):
            return False

    match params:
        case {"PayloadType": "application/json", "Payload": str(payload)}:
            params["Payload"] = loads(payload)
        case _:
            return False

    json = dump_json(params)
    hashed = sha1(json.encode()).hexdigest()

    _sns.publish(TopicArn=_channel(), Subject=f"/twilio/error - {hashed}", Message=json)
    return True


def proc_twilio(span: Span, record: SQSRecord) -> None:
    ctx = _context(record)
    with TRACER.start_as_current_span("process record", context=ctx) as s:
        s.add_link(span.get_span_context())
        span.add_link(s.get_span_context())

        ok = _proc(record)
        span.set_status(StatusCode.OK if ok else StatusCode.ERROR)
