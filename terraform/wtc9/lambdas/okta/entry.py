from collections.abc import Mapping
from contextlib import nullcontext
from logging import INFO, captureWarnings, getLogger
from typing import Any

from aws_lambda_powertools.utilities.data_classes import (
    LambdaFunctionUrlEvent,
    event_source,
)
from aws_lambda_powertools.utilities.data_classes.api_gateway_authorizer_event import (
    APIGatewayAuthorizerResponseV2,
)
from aws_lambda_powertools.utilities.typing import LambdaContext

with nullcontext():
    captureWarnings(True)
    getLogger().setLevel(INFO)


@event_source(data_class=LambdaFunctionUrlEvent)
def main(event: LambdaFunctionUrlEvent, _: LambdaContext) -> Mapping[str, Any]:
    getLogger().info("%s", ">>> >>> >>>")
    __ = event.path

    return APIGatewayAuthorizerResponseV2(authorize=True).asdict()
