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
from opentelemetry.propagate import extract
from opentelemetry.trace import (
    NonRecordingSpan,
    get_tracer,
    set_span_in_context,
)

from .. import _
from .routes import app

with nullcontext():
    _TRACER = get_tracer(__name__)


@event_source(data_class=APIGatewayProxyEventV2)
def main(event: APIGatewayProxyEventV2, ctx: LambdaContext) -> Mapping[str, Any]:
    context = extract(event.request_context.authorizer.get_lambda)
    for v in context.values():
        if isinstance(v, NonRecordingSpan):
            ct = set_span_in_context(v)
            break
    else:
        assert False

    with _TRACER.start_as_current_span("router", context=ct):
        return app.resolve(event.raw_event, context=ctx)
