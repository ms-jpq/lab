from base64 import b64encode
from collections.abc import Mapping, Set
from contextlib import nullcontext
from functools import cache
from hashlib import sha1
from hmac import HMAC, compare_digest
from http import HTTPStatus
from itertools import chain, product
from json import loads
from os import environ
from typing import cast
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
def _numbers() -> Set[str]:
    json = loads(environ["ENV_TWILIO_REDIRECTS"])
    return {*json}


def _params(event: APIGatewayProxyEventV2) -> Mapping[str, str]:
    if parsed := event.raw_event.get(_ID):
        return cast(Mapping[str, str], parsed)

    parsed = dict(parse_qsl(event.decoded_body, keep_blank_values=True))
    event.raw_event.setdefault(_ID, parsed)
    return parsed


def _auth(
    app: APIGatewayHttpResolver, next_middleware: NextMiddleware
) -> Response[None]:
    event = app.current_event
    if not (signature := event.headers.get("x-twilio-signature")):
        return Response(status_code=HTTPStatus.UNAUTHORIZED)

    ordered = sorted(_params(app.current_event).items())
    auth_key = environ["ENV_TWILIO_TOKEN"].encode()
    auth_msg = "".join(chain((raw_uri(event),), chain.from_iterable(ordered))).encode()

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
    dial = SubElement(root, "Dial")

    sinks = _numbers()
    match _params(app.current_event):
        case {"Caller": src, "Called": dst}:
            sinks -= {src, dst}

    for tel in sinks:
        SubElement(dial, "Number").text = tel

    return _reply(root)


@app.post("/twilio/message", middlewares=[_auth])
def message() -> Response[str]:
    root = Element("Response")

    sinks = numbers = _numbers()
    match _params(app.current_event):
        case {"From": src, "To": dst, "Body": msg}:
            sinks -= {src, dst}
            texts = (msg,) if src in numbers else (f">>> {src}", msg)

            for tel, text in product(sinks, texts):
                SubElement(root, "Message", attrib={"to": tel}).text = text

            return _reply(root)
        case _:
            return Response(status_code=HTTPStatus.BAD_REQUEST)
