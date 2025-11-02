from base64 import b64encode
from collections.abc import Iterator, Mapping, Sequence, Set
from contextlib import contextmanager, nullcontext
from datetime import datetime, timedelta, timezone
from functools import cache, partial
from hashlib import sha1
from hmac import HMAC, compare_digest
from http import HTTPStatus
from itertools import chain
from json import loads
from logging import getLogger
from os import environ
from typing import cast
from urllib.parse import parse_qsl
from uuid import uuid4
from xml.etree.ElementTree import Element, SubElement, indent, tostring

from aws_lambda_powertools.event_handler import APIGatewayHttpResolver
from aws_lambda_powertools.event_handler.api_gateway import Response
from aws_lambda_powertools.event_handler.middlewares import (
    NextMiddleware,
)
from aws_lambda_powertools.utilities.data_classes import APIGatewayProxyEventV2

from ... import executor, log_span
from . import app, dynamodb, raw_uri

with nullcontext():
    _ID = uuid4().hex


@cache
def _routes() -> Set[str]:
    json = loads(environ["ENV_TWILIO_REDIRECTS"])
    return {*json}


@cache
def _table() -> str:
    return environ["ENV_TBL_NAME"]


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
    indent(el)
    body = tostring(el, encoding="unicode", xml_declaration=True)
    getLogger().info("%s", body)
    return Response(
        status_code=HTTPStatus.OK,
        headers={"content-type": "application/xml"},
        body=body,
    )


@app.post("/twilio/voice", middlewares=[_auth])
def voice() -> Response[str]:
    root = Element("Response")
    dial = SubElement(root, "Dial")

    routes = _routes()
    match _params(app.current_event):
        case {"Caller": src, "Called": dst}:
            routes -= {src, dst}

    for tel in routes:
        SubElement(dial, "Number").text = tel

    return _reply(root)


@contextmanager
def _suppress_exns() -> Iterator[None]:
    try:
        yield None
    except Exception as e:
        getLogger().error("%s", e)


def _id(dst: str, route_to: str) -> str:
    id = f"twilio-{dst}>>>{route_to}"
    return id


def _upsert_reply_to(dst: str, route_to: str, reply_to: str) -> None:
    id = _id(dst, route_to=route_to)
    ttl = int((datetime.now(tz=timezone.utc) + timedelta(weeks=4)).timestamp())
    with _suppress_exns():
        dynamodb.put_item(
            TableName=_table(),
            Item={
                "ID": {"S": id},
                "TTL": {"N": str(ttl)},
                "Reply-To": {"S": reply_to},
            },
        )


def _retrieve_reply_to(dst: str, route_to: str) -> str | None:
    id = _id(dst, route_to=route_to)
    with _suppress_exns():
        rsp = dynamodb.get_item(
            TableName=_table(),
            Key={"ID": {"S": id}},
        )
        match rsp:
            case {"Item": {"Reply-To": {"S": str(prev_reply_to)}}}:
                return prev_reply_to

    return None


def _messages(
    src: str, dst: str, body: str, route_to: str
) -> Sequence[tuple[str, Sequence[str]]]:
    prefix = ">>> "
    instruction = body.startswith(prefix) and len(body.splitlines()) == 1
    question = body == "???"

    if route_to == dst:
        """
        forwarding text to twilio #
        """
        assert False

    elif route_to == src:
        getLogger().info(
            "%s",
            f"*** route_to={route_to} received text from a privileged # ***",
        )
        if question:
            getLogger().info(
                "%s",
                f"*** route_to={route_to} received question for reply destination ***",
            )

            if prev_reply_to := _retrieve_reply_to(dst=dst, route_to=route_to):
                _upsert_reply_to(dst=dst, route_to=route_to, reply_to=prev_reply_to)

            return ((route_to, (f"<<< {prev_reply_to}",)),)
        elif instruction:
            getLogger().info(
                "%s",
                f"*** route_to={route_to} received instruction for reply destination ***",
            )

            set_reply_to = body.removeprefix(prefix)
            _upsert_reply_to(dst=dst, route_to=route_to, reply_to=set_reply_to)

            return ((route_to, (f"*** {set_reply_to}",)),)
        elif prev_reply_to := _retrieve_reply_to(dst=dst, route_to=route_to):
            getLogger().info(
                "%s",
                f"*** route_to={route_to} found previous reply destination ***",
            )
            _upsert_reply_to(dst=dst, route_to=route_to, reply_to=prev_reply_to)

            return ((route_to, (f"<<< {prev_reply_to}",)), (prev_reply_to, (body,)))
        else:
            getLogger().info(
                "%s",
                f"*** route_to={route_to} did not find previous reply destination ***",
            )

            others = tuple(prefix + tel for tel in (_routes() - {route_to}))
            return ((route_to, others),)
    elif src in _routes() and (question or instruction):
        getLogger().info(
            "%s",
            f"*** route_to={route_to} received instruction from another privileged # ***",
        )

        return ()
    else:
        getLogger().info(
            "%s", f"*** route_to={route_to} received text from an arbitrary # ***"
        )

        reply_to = src
        _upsert_reply_to(dst=dst, route_to=route_to, reply_to=reply_to)

        return ((route_to, (prefix + reply_to, body)),)


@app.post("/twilio/message", middlewares=[_auth])
def message() -> Response[str]:
    root = Element("Response")

    with log_span():
        match _params(app.current_event):
            case {"From": src, "To": dst, "Body": body}:
                """
                dst is always a twilio number
                """

                fn = partial(_messages, src, dst, body)
                for pairs in executor().map(fn, _routes()):
                    for tel, msgs in pairs:
                        for msg in msgs:
                            SubElement(root, "Message", attrib={"to": tel}).text = msg

                return _reply(root)
            case _:
                return Response(status_code=HTTPStatus.BAD_REQUEST)
