from base64 import b64decode
from collections.abc import Iterator, Mapping
from contextlib import nullcontext
from functools import cache
from hashlib import sha256
from hmac import HMAC, compare_digest
from os import environ
from typing import Any
from uuid import uuid4

from aws_lambda_powertools.utilities.data_classes import event_source
from aws_lambda_powertools.utilities.data_classes.api_gateway_authorizer_event import (
    APIGatewayAuthorizerEventV2,
    APIGatewayAuthorizerResponseV2,
)
from aws_lambda_powertools.utilities.typing import LambdaContext

from .. import _

with nullcontext():
    _SEC = uuid4().hex.encode()


def _hmac(msg: str) -> str:
    hmac = HMAC(_SEC, msg.encode(), digestmod=sha256)
    return hmac.hexdigest()


@cache
def _authorized_users() -> Mapping[str, str]:
    def cont() -> Iterator[tuple[str, str]]:
        for users in environ["ENV_AUTH_USERS"].split(","):
            lhs, sep, rhs = users.partition(":")
            assert sep == ":"
            yield lhs, _hmac(rhs)

    return {k: v for k, v in cont()}


def _basic_auth(event: APIGatewayAuthorizerEventV2) -> bool:
    auth = event.headers.get("authorization", "")
    _, sep, rhs = auth.partition(" ")
    if sep != " ":
        return False

    try:
        decoded = b64decode(rhs).decode()
    except UnicodeDecodeError:
        return False

    lhs, sep, rhs = decoded.partition(":")
    if not sep == ":":
        return False

    if not (digest := _authorized_users().get(lhs)):
        return False

    return compare_digest(_hmac(rhs), digest)


def _auth(event: APIGatewayAuthorizerEventV2) -> bool:
    if event.raw_path in {"/echo"}:
        return True

    for route in ("/owncloud/",):
        if event.raw_path.startswith(route):
            return True

    if event.raw_path in {}:
        return _basic_auth(event)

    for route in ("/twilio/",):
        if event.raw_path.startswith(route):
            return _basic_auth(event)
    else:
        return False


@event_source(data_class=APIGatewayAuthorizerEventV2)
def main(event: APIGatewayAuthorizerEventV2, _: LambdaContext) -> Mapping[str, Any]:
    authorize = _auth(event)
    return APIGatewayAuthorizerResponseV2(authorize=authorize).asdict()
