from base64 import b64decode
from collections.abc import Iterator, Mapping, MutableMapping
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
from opentelemetry.baggage import set_baggage
from opentelemetry.instrumentation.aws_lambda import AwsLambdaInstrumentor
from opentelemetry.propagate import inject
from opentelemetry.trace import get_tracer
from opentelemetry.trace.status import StatusCode

from .. import _
from ..telemetry import flush_otlp

with nullcontext():
    TRACER = get_tracer(__name__)
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

    for route in ("/owncloud/", "/twilio/"):
        if event.raw_path.startswith(route):
            return True

    if event.raw_path in {}:
        return _basic_auth(event)

    for route in ():
        if event.raw_path.startswith(route):
            return _basic_auth(event)
    else:
        return False


def _inject_signature(
    event: APIGatewayAuthorizerEventV2, carrier: MutableMapping[str, Any]
) -> None:
    signature = ""

    if event.raw_path.startswith("/twilio/"):
        signature = event.headers.get("x-twilio-signature", "")

    carrier.setdefault("signature", signature)


@flush_otlp
@event_source(data_class=APIGatewayAuthorizerEventV2)
def main(event: APIGatewayAuthorizerEventV2, _: LambdaContext) -> Mapping[str, Any]:
    context: dict[str, Any] = {}
    with TRACER.start_as_current_span("auth"):
        with TRACER.start_as_current_span("auth verdict") as span:
            if not (authorized := _auth(event)):
                span.add_event("das.ist.verboten", attributes=event.raw_event)
            span.set_status(StatusCode.OK if authorized else StatusCode.ERROR)

        _inject_signature(event, carrier=context)
        ctx = set_baggage("request_id", event.request_context.request_id)
        inject(context, context=ctx)

        rsp = APIGatewayAuthorizerResponseV2(authorize=authorized, context=context)
        return rsp.asdict()


with nullcontext():
    AwsLambdaInstrumentor().instrument()
