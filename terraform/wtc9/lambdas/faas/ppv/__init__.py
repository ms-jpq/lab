from collections.abc import Mapping
from contextlib import nullcontext
from itertools import permutations
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
    get_current_span,
    get_tracer,
)

from .. import _
from .routes import app

with nullcontext():
    _TRACER = get_tracer(__name__)


@event_source(data_class=APIGatewayProxyEventV2)
def main(event: APIGatewayProxyEventV2, ctx: LambdaContext) -> Mapping[str, Any]:
    span = get_current_span()
    context = extract(event.request_context.authorizer.get_lambda)

    with _TRACER.start_as_current_span("router", context=context) as s:
        for l, r in permutations((s, span), 2):
            l.add_link(r.get_span_context())
        return app.resolve(event.raw_event, context=ctx)
