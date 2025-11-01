from contextlib import nullcontext
from functools import cache
from http import HTTPStatus
from os import environ, linesep

from aws_lambda_powertools.event_handler import APIGatewayHttpResolver
from aws_lambda_powertools.event_handler.api_gateway import Response
from aws_lambda_powertools.event_handler.middlewares import (
    NextMiddleware,
)

from twilio.request_validator import RequestValidator
from twilio.twiml.messaging_response import MessagingResponse
from twilio.twiml.voice_response import VoiceResponse

from . import app, raw_uri

with nullcontext():
    _REDIRECT = environ.get("TWILIO_REDIRECT")


@cache
def _request_validator() -> RequestValidator:
    return RequestValidator(token=environ[""])


def _auth(app: APIGatewayHttpResolver, next_middleware: NextMiddleware) -> Response:
    event = app.current_event
    if not (signature := event.headers.get("x-twilio-signature")):
        return Response(status_code=HTTPStatus.UNAUTHORIZED)

    rv, uri = _request_validator(), raw_uri(event)
    if not rv.validate(uri=uri, params=event.body, signature=signature):
        return Response(status_code=HTTPStatus.FORBIDDEN)

    return next_middleware.__call__(app)


@app.get("/twilio/voice", middlewares=[_auth])
def voice() -> Response[str]:
    rsp = VoiceResponse()
    rsp.dial(number=_REDIRECT)
    return Response(status_code=HTTPStatus.OK, body=str(rsp))


@app.get("/twilio/message", middlewares=[_auth])
def message() -> Response[str]:
    match app.current_event.json_body:
        case {"From": str(xfrom), "Body": str(body)}:
            msg = f">>> {xfrom}{linesep}" + body

            rsp = MessagingResponse()
            rsp.message(to=_REDIRECT, body=msg)
            return Response(status_code=HTTPStatus.OK, body=str(rsp))
        case _:
            return Response(status_code=HTTPStatus.BAD_REQUEST)
