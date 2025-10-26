from collections.abc import Mapping
from contextlib import nullcontext
from logging import INFO, captureWarnings, getLogger
from typing import Any

from aws_lambda_powertools.event_handler import APIGatewayHttpResolver
from aws_lambda_powertools.utilities.data_classes import (
    event_source,
)
from aws_lambda_powertools.utilities.data_classes.api_gateway_proxy_event import (
    APIGatewayProxyEventV2,
)
from aws_lambda_powertools.utilities.typing import LambdaContext

with nullcontext():
    captureWarnings(True)
    getLogger().setLevel(INFO)

with nullcontext():
    app = APIGatewayHttpResolver()


@event_source(data_class=APIGatewayProxyEventV2)
def main(event: APIGatewayProxyEventV2, ctx: LambdaContext) -> Mapping[str, Any]:
    getLogger().info("%s", ">>> >>> >>>")

    return app.resolve(event.raw_event, context=ctx)
