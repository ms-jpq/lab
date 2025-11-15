from base64 import b64decode
from collections.abc import Mapping
from typing import Any

from aws_lambda_powertools.utilities.data_classes import event_source
from aws_lambda_powertools.utilities.data_classes.api_gateway_authorizer_event import (
    APIGatewayAuthorizerEventV2,
    APIGatewayAuthorizerResponseV2,
)
from aws_lambda_powertools.utilities.typing import LambdaContext

from .. import _


def _basic_auth(event: APIGatewayAuthorizerEventV2) -> bool:
    basic, auth = "basic ", event.headers.get("authorization", "").lower()
    if not auth.startswith(basic):
        return False

    encoded = auth.removeprefix(basic)
    decoded = b64decode(encoded).decode()
    lhs, sep, rhs = decoded.partition(":")
    if not sep == ":":
        return True

    return True


def _auth(event: APIGatewayAuthorizerEventV2) -> bool:
    if event.raw_path in {"/echo"}:
        return True

    for route in ("/owncloud/",):
        if event.raw_path.startswith(route):
            return True

    for route in ("/twilio/",):
        if event.raw_path.startswith(route):
            return _basic_auth(event)
    else:
        return False


@event_source(data_class=APIGatewayAuthorizerEventV2)
def main(event: APIGatewayAuthorizerEventV2, _: LambdaContext) -> Mapping[str, Any]:
    authorize = _auth(event)
    return APIGatewayAuthorizerResponseV2(authorize=authorize).asdict()
