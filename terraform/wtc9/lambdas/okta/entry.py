from collections.abc import Mapping
from contextlib import nullcontext
from logging import INFO, captureWarnings, getLogger
from typing import Any

from aws_lambda_powertools.utilities.data_classes import (
    event_source,
)
from aws_lambda_powertools.utilities.data_classes.api_gateway_authorizer_event import (
    APIGatewayAuthorizerEventV2,
    APIGatewayAuthorizerResponseV2,
)
from aws_lambda_powertools.utilities.typing import LambdaContext

with nullcontext():
    captureWarnings(True)
    getLogger().setLevel(INFO)


@event_source(data_class=APIGatewayAuthorizerEventV2)
def main(event: APIGatewayAuthorizerEventV2, _: LambdaContext) -> Mapping[str, Any]:

    return APIGatewayAuthorizerResponseV2(authorize=False).asdict()
