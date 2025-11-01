from base64 import b64encode
from collections.abc import Mapping
from contextlib import nullcontext
from functools import cache
from hashlib import sha1
from hmac import HMAC, compare_digest
from http import HTTPStatus
from itertools import chain
from os import environ
from urllib.parse import parse_qsl
from uuid import uuid4
from xml.etree.ElementTree import Element, SubElement, tostring

from aws_lambda_powertools.event_handler import APIGatewayHttpResolver
from aws_lambda_powertools.event_handler.api_gateway import Response
from aws_lambda_powertools.event_handler.middlewares import (
    NextMiddleware,
)
from aws_lambda_powertools.utilities.data_classes import APIGatewayProxyEventV2

from . import app, raw_uri

with nullcontext():
    _ID = uuid4().hex


@cache
def _redirect() -> str:
    return environ["ENV_TWILIO_REDIRECT"]


def _params(event: APIGatewayProxyEventV2) -> Mapping[str, str]:
    if parsed := event.raw_event.get(_ID):
        return parsed

    parsed = dict(parse_qsl(event.decoded_body, keep_blank_values=True))
    event.raw_event.setdefault(_ID, parsed)
    return parsed


def _auth(
    app: APIGatewayHttpResolver, next_middleware: NextMiddleware
) -> Response[None]:
    event = app.current_event
    if not (signature := event.headers.get("x-twilio-signature")):
        return Response(status_code=HTTPStatus.UNAUTHORIZED)

    auth_key = environ["ENV_TWILIO_TOKEN"].encode()
    auth_msg = "".join(
        chain(
            (raw_uri(event),),
            chain.from_iterable(sorted(_params(app.current_event).items())),
        )
    ).encode()

    hmac = HMAC(auth_key, auth_msg, digestmod=sha1)
    expected = b64encode(hmac.digest()).decode()

    if not compare_digest(signature, expected):
        return Response(status_code=HTTPStatus.FORBIDDEN)

    return next_middleware.__call__(app)


def _reply(el: Element) -> Response[str]:
    body = tostring(el, encoding="unicode", xml_declaration=True)
    return Response(
        status_code=HTTPStatus.OK,
        headers={"content-type": "application/xml"},
        body=body,
    )


@app.post("/twilio/voice", middlewares=[_auth])
def voice() -> Response[str]:
    root = Element("Response")

    match _params(app.current_event):
        case _:
            SubElement(root, "Dial").text = _redirect()

            return _reply(root)


@app.post("/twilio/message", middlewares=[_auth])
def message() -> Response[str]:
    root = Element("Response")
    redirect = {"to": _redirect()}

    match _params(app.current_event):
        case {"From": xfrom, "Body": body} if xfrom == _redirect():
            SubElement(root, "Message", attrib=redirect).text = body

            return _reply(root)
        case {"From": xfrom, "Body": body}:
            SubElement(root, "Message", attrib=redirect).text = f">>> {xfrom}"
            SubElement(root, "Message", attrib=redirect).text = body

            return _reply(root)
        case _:
            return Response(status_code=HTTPStatus.BAD_REQUEST)
