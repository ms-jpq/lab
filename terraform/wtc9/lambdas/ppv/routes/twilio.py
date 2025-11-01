from base64 import b64encode
from collections.abc import Mapping
from functools import cache
from hashlib import sha1
from hmac import HMAC, compare_digest
from http import HTTPStatus
from os import environ, linesep
from urllib.parse import parse_qsl
from xml.etree.ElementTree import Element, tostring

from aws_lambda_powertools.event_handler import APIGatewayHttpResolver
from aws_lambda_powertools.event_handler.api_gateway import Response
from aws_lambda_powertools.event_handler.middlewares import (
    NextMiddleware,
)
from aws_lambda_powertools.utilities.data_classes import APIGatewayProxyEventV2

from . import app, raw_uri


@cache
def _redirect() -> str:
    return environ["ENV_TWILIO_REDIRECT"]


def _params(event: APIGatewayProxyEventV2) -> Mapping[str, str]:
    return dict(parse_qsl(event.decoded_body))


def _auth(
    app: APIGatewayHttpResolver, next_middleware: NextMiddleware
) -> Response[None]:
    event = app.current_event
    if not (signature := event.headers.get("x-twilio-signature")):
        return Response(status_code=HTTPStatus.UNAUTHORIZED)

    auth_key = environ["ENV_TWILIO_TOKEN"].encode()
    acc = [raw_uri(event)]
    for key, val in sorted(_params(app.current_event).items()):
        acc.extend((key, val))
    auth_msg = "".join(acc).encode()

    hmac = HMAC(auth_key, auth_msg, digestmod=sha1)
    expected = b64encode(hmac.digest()).decode()

    if not compare_digest(signature, expected):
        pass

    return next_middleware.__call__(app)


@app.post("/twilio/voice", middlewares=[_auth])
def voice() -> Response[bytes]:
    msg = Element("Dial")
    msg.text = _redirect()
    root = Element("Response")
    root.append(msg)

    return Response(
        status_code=HTTPStatus.OK, body=tostring(root, xml_declaration=True)
    )


@app.post("/twilio/message", middlewares=[_auth])
def message() -> Response[bytes]:
    match _params(app.current_event):
        case {"From": xfrom, "Body": body}:
            msg = Element("Message", attrib={"to": _redirect()})
            msg.text = f">>> {xfrom}{linesep}{body}"
            root = Element("Response")
            root.append(msg)

            return Response(
                status_code=HTTPStatus.OK, body=tostring(root, xml_declaration=True)
            )
        case _:
            return Response(status_code=HTTPStatus.BAD_REQUEST)
