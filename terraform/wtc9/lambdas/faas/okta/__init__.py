from collections.abc import Mapping
from contextlib import nullcontext
from typing import Any

from aws_lambda_powertools.utilities.data_classes import event_source
from aws_lambda_powertools.utilities.data_classes.api_gateway_authorizer_event import (
    APIGatewayAuthorizerEventV2,
    APIGatewayAuthorizerResponseV2,
)
from aws_lambda_powertools.utilities.typing import LambdaContext

from .. import _

with nullcontext():
    _BASIC = "basic "


def _auth(event: APIGatewayAuthorizerEventV2) -> bool:
    if event.raw_path in {"echo"}:
        return True

    if event.raw_path.startswith("/owncloud/"):
        return True

    if event.raw_path.startswith("/twilio/"):
        if (
            not (auth := event.headers.get("authorization", ""))
            .lower()
            .startswith(_BASIC)
        ):
            _ = auth.removeprefix(_BASIC)

        return True

    return False


@event_source(data_class=APIGatewayAuthorizerEventV2)
def main(event: APIGatewayAuthorizerEventV2, _: LambdaContext) -> Mapping[str, Any]:
    authorize = _auth(event)
    return APIGatewayAuthorizerResponseV2(authorize=authorize).asdict()
