from collections.abc import Mapping
from contextlib import nullcontext
from functools import cache
from hashlib import sha1
from json import loads
from os import environ
from typing import Any

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
from boto3 import client  # pyright:ignore
from opentelemetry.context.context import Context
from opentelemetry.instrumentation.aws_lambda import AwsLambdaInstrumentor
from opentelemetry.propagate import extract

from .. import B3_CONF, _, dump_json
from ..twilio import parse_params, verify

with nullcontext():
    _PROC = BatchProcessor(event_type=EventType.SQS)
    _sns = client(service_name="sns", config=B3_CONF)


@cache
def _channel() -> str:
    return environ["ENV_CHAN_NAME"]


def _handler(record: SQSRecord) -> None:
    match record.raw_event:
        case {
            "messageAttributes": {
                "RawURL": {"stringValue": str(uri)},
                "Signature": {"stringValue": str(signature)},
            }
        }:
            params = parse_params(record.body)
        case _:
            return

    if not verify(uri, params=params, signature=signature):
        return

    match params:
        case {"PayloadType": "application/json", "Payload": str(payload)}:
            params["Payload"] = loads(payload)
        case _:
            return

    json = dump_json(params)
    hashed = sha1(json.encode()).hexdigest()

    _sns.publish(TopicArn=_channel(), Subject=f"/twilio/error - {hashed}", Message=json)


@event_source(data_class=SQSEvent)
def main(event: SQSEvent, ctx: LambdaContext) -> PartialItemFailureResponse:
    return process_partial_response(
        processor=_PROC,
        event=event.raw_event,
        context=ctx,
        record_handler=_handler,
    )


def _extract(event: Mapping[str, Any]) -> Context:
    carrier = {"traceparent": event["messageAttributes"]["TraceParent"]["stringValue"]}
    return extract(carrier)


AwsLambdaInstrumentor().instrument(event_context_extractor=_extract)
