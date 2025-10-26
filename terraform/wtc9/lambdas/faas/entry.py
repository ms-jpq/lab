from collections.abc import Mapping
from contextlib import nullcontext
from logging import INFO, captureWarnings, getLogger
from typing import Any

from aws_lambda_powertools.utilities.data_classes import (
    event_source,
)
from aws_lambda_powertools.utilities.data_classes.api_gateway_proxy_event import (
    APIGatewayProxyEventV2,
)
from aws_lambda_powertools.utilities.typing import LambdaContext

from .routes import app

with nullcontext():
    captureWarnings(True)
    getLogger().setLevel(INFO)


@event_source(data_class=APIGatewayProxyEventV2)
def main(event: APIGatewayProxyEventV2, ctx: LambdaContext) -> Mapping[str, Any]:
    getLogger().info("%s", ">>> >>> >>>")
    try:
        return app.resolve(event.raw_event, context=ctx)
    finally:
        getLogger().info("%s", "<<< <<< <<<")
