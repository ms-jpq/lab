from collections.abc import Mapping
from contextlib import nullcontext
from functools import cache
from http import HTTPStatus
from os import environ, linesep
from urllib.parse import parse_qsl

from aws_lambda_powertools.event_handler import APIGatewayHttpResolver
from aws_lambda_powertools.event_handler.api_gateway import Response
from aws_lambda_powertools.event_handler.middlewares import (
    NextMiddleware,
)
from aws_lambda_powertools.utilities.data_classes import APIGatewayProxyEventV2
from twilio.request_validator import RequestValidator  # type: ignore

from . import app, raw_uri

with nullcontext():
    _REDIRECT = environ.get("ENV_TWILIO_REDIRECT")


@cache
def _request_validator() -> RequestValidator:
    token = environ["ENV_TWILIO_TOKEN"]
    return RequestValidator(token)


def _params(event: APIGatewayProxyEventV2) -> Mapping[str, str]:
    return dict(parse_qsl(event.decoded_body))


def _auth(
    app: APIGatewayHttpResolver, next_middleware: NextMiddleware
) -> Response[None]:
    event = app.current_event
    if not (signature := event.headers.get("x-twilio-signature")):
        return Response(status_code=HTTPStatus.UNAUTHORIZED)

    rv, uri = _request_validator(), raw_uri(event)
    params = _params(app.current_event)

    print(dict(body=event.decoded_body, params=params, uri=uri, signature=signature))
    if not rv.validate(uri=uri, params=params, signature=signature):
        return Response(status_code=HTTPStatus.FORBIDDEN)

    return next_middleware.__call__(app)


@app.post("/twilio/voice", middlewares=[_auth])
def voice() -> Response[str]:
    from twilio.twiml.voice_response import VoiceResponse  # type: ignore

    rsp = VoiceResponse()
    rsp.dial(number=_REDIRECT)
    return Response(status_code=HTTPStatus.OK, body=str(rsp))


@app.post("/twilio/message", middlewares=[_auth])
def message() -> Response[str]:
    from twilio.twiml.messaging_response import MessagingResponse  # type: ignore

    match _params(app.current_event):
        case {"From": xfrom, "Body": body}:
            msg = f">>> {xfrom}{linesep}{body}"
            rsp = MessagingResponse()
            rsp.message(to=_REDIRECT, body=msg)
            return Response(status_code=HTTPStatus.OK, body=str(rsp))
        case _:
            return Response(status_code=HTTPStatus.BAD_REQUEST)
