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
from opentelemetry.context.context import Context
from opentelemetry.instrumentation.aws_lambda import AwsLambdaInstrumentor
from opentelemetry.propagate import extract

from .. import _
from ..telemetry import flush_otlp
from .routes import TRACER, app


@flush_otlp
@event_source(data_class=APIGatewayProxyEventV2)
def main(event: APIGatewayProxyEventV2, ctx: LambdaContext) -> Mapping[str, Any]:
    with TRACER.start_as_current_span("router") as span:
        span.add_event("routing", attributes={"path": event.path})
        return app.resolve(event.raw_event, context=ctx)


def _extract(event: Mapping[str, Any]) -> Context:
    return extract(event["requestContext"]["authorizer"].get("lambda") or {})


with nullcontext():
    AwsLambdaInstrumentor().instrument(event_context_extractor=_extract)
