from collections.abc import Mapping
from typing import Any

from aws_lambda_powertools.utilities.data_classes import (
    event_source,
)
from aws_lambda_powertools.utilities.data_classes.api_gateway_proxy_event import (
    APIGatewayProxyEventV2,
)
from aws_lambda_powertools.utilities.typing import LambdaContext
from opentelemetry.context.context import Context
from opentelemetry.propagate import extract
from opentelemetry.trace import SpanKind

from .. import _
from ..telemetry import entry
from .routes import TRACER, app


def _extract(event: APIGatewayProxyEventV2) -> Context:
    return extract(event.request_context.authorizer.get_lambda)


@event_source(data_class=APIGatewayProxyEventV2)
@entry(kind=SpanKind.SERVER, event_context_extractor=_extract)
def main(event: APIGatewayProxyEventV2, ctx: LambdaContext) -> Mapping[str, Any]:
    with TRACER.start_as_current_span("router") as span:
        span.add_event("routing", attributes={"path": event.path})
        return app.resolve(event.raw_event, context=ctx)
