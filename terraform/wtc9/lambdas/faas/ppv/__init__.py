from collections.abc import Mapping
from contextlib import nullcontext
from typing import Any

from aws_lambda_powertools.utilities.data_classes import (
    event_source,
)
from aws_lambda_powertools.utilities.data_classes.api_gateway_proxy_event import (
    APIGatewayProxyEventV2,
)
from aws_lambda_powertools.utilities.typing import LambdaContext

from .. import _

"""
"""

from opentelemetry.context.context import Context
from opentelemetry.instrumentation.aws_lambda import AwsLambdaInstrumentor
from opentelemetry.propagate import extract
from opentelemetry.trace import get_tracer

from .routes import app

with nullcontext():
    _TRACER = get_tracer(__name__)


@event_source(data_class=APIGatewayProxyEventV2)
def main(event: APIGatewayProxyEventV2, ctx: LambdaContext) -> Mapping[str, Any]:
    with _TRACER.start_as_current_span("router"):
        return app.resolve(event.raw_event, context=ctx)


def _extract(event: Mapping[str, Any]) -> Context:
    return extract(event["requestContext"]["authorizer"].get("lambda") or {})


AwsLambdaInstrumentor().instrument(event_context_extractor=_extract)
