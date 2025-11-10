from collections.abc import Mapping
from typing import Any

from aws_lambda_powertools.utilities.data_classes import event_source
from aws_lambda_powertools.utilities.data_classes.api_gateway_authorizer_event import (
    APIGatewayAuthorizerEventV2,
    APIGatewayAuthorizerResponseV2,
)
from aws_lambda_powertools.utilities.typing import LambdaContext

from .. import _


@event_source(data_class=APIGatewayAuthorizerEventV2)
def main(event: APIGatewayAuthorizerEventV2, _: LambdaContext) -> Mapping[str, Any]:
    if event.raw_path.startswith("/webhooks"):
        pass

    return APIGatewayAuthorizerResponseV2(authorize=False).asdict()
