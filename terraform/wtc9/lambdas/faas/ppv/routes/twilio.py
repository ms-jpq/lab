from collections import defaultdict
from collections.abc import Mapping, MutableSet, Sequence, Set
from datetime import datetime, timedelta, timezone
from functools import cache
from http import HTTPStatus
from json import loads
from logging import getLogger
from os import environ
from xml.etree.ElementTree import Element, SubElement, indent, tostring

from aws_lambda_powertools.event_handler import APIGatewayHttpResolver
from aws_lambda_powertools.event_handler.api_gateway import Response
from aws_lambda_powertools.event_handler.middlewares import (
    NextMiddleware,
)

from ... import executor, suppress_exn
from ...telemetry import with_context
from ...twilio import parse_params, verify
from . import app, compute_once, current_raw_uri, dynamodb

_Routed = Sequence[tuple[str, Sequence[str]]]


@cache
def _routes() -> Set[str]:
    json = loads(environ["ENV_TWILIO_REDIRECTS"])
    return {*json}


@cache
def _table() -> str:
    return environ["ENV_TBL_NAME"]


@compute_once
def _current_params() -> dict[str, str]:
    return parse_params(app.current_event.decoded_body)


def _auth(
    app: APIGatewayHttpResolver, next_middleware: NextMiddleware
) -> Response[None]:
    event = app.current_event
    if not (signature := event.headers.get("x-twilio-signature")):
        return Response(status_code=HTTPStatus.UNAUTHORIZED)

    if not verify(current_raw_uri(), params=_current_params(), signature=signature):
        return Response(status_code=HTTPStatus.FORBIDDEN)

    return next_middleware.__call__(app)


def _xml_ok(el: Element) -> Response[str]:
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
    match _current_params():
        case {"Caller": src, "Called": dst}:
            routes -= {src, dst}

    for tel in routes:
        SubElement(dial, "Number").text = tel

    return _xml_ok(root)


def _id(dst: str, route_to: str) -> str:
    id = f"twilio-{dst}>>>{route_to}"
    return id


def _upsert_reply_to(dst: str, route_to: str, reply_to: str) -> None:
    id = _id(dst, route_to=route_to)
    ttl = int((datetime.now(tz=timezone.utc) + timedelta(hours=8)).timestamp())
    with suppress_exn():
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
    with suppress_exn():
        rsp = dynamodb.get_item(
            TableName=_table(),
            Key={"ID": {"S": id}},
        )
        match rsp:
            case {"Item": {"Reply-To": {"S": str(prev_reply_to)}}}:
                return prev_reply_to

    return None


def _messages(src: str, dst: str, body: str, route_to: str) -> _Routed:
    prefix_1, prefix_2 = ">>> ", "<<< "
    instruction = body.startswith((prefix_1, prefix_2)) and len(body.splitlines()) == 1
    question = body == "???"
    if body.lower() == "nein":
        body = "STOP"

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

            return ((route_to, (prefix_2 + str(prev_reply_to),)),)
        elif instruction:
            getLogger().info(
                "%s",
                f"*** route_to={route_to} received instruction for reply destination ***",
            )

            set_reply_to = body.removeprefix(prefix_1).removeprefix(prefix_2)
            _upsert_reply_to(dst=dst, route_to=route_to, reply_to=set_reply_to)

            return ((route_to, (f"*** {set_reply_to}",)),)
        elif prev_reply_to := _retrieve_reply_to(dst=dst, route_to=route_to):
            getLogger().info(
                "%s",
                f"*** route_to={route_to} found previous reply destination ***",
            )
            _upsert_reply_to(dst=dst, route_to=route_to, reply_to=prev_reply_to)

            return ((route_to, (prefix_2 + prev_reply_to,)), (prev_reply_to, (body,)))
        else:
            getLogger().info(
                "%s",
                f"*** route_to={route_to} did not find previous reply destination ***",
            )

            others = tuple(prefix_1 + tel for tel in (_routes() - {route_to}))
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

        return ((route_to, (prefix_1 + reply_to, body)),)


@app.post("/twilio/message", middlewares=[_auth])
def message() -> Response[str]:
    root = Element("Response")
    w_ctx = with_context()

    match _current_params():
        case {"From": src, "To": dst, "Body": body}:
            """
            dst is always a twilio number
            """

            def cont(route_to: str) -> _Routed:
                with w_ctx():
                    return _messages(src, dst=dst, body=body, route_to=route_to)

            seen: Mapping[str, MutableSet[int]] = defaultdict(set)
            for pairs in executor().map(cont, _routes()):
                for tel, msgs in pairs:
                    acc = seen[tel]
                    for msg in msgs:
                        key = hash(msg)
                        if not key in acc:
                            SubElement(root, "Message", attrib={"to": tel}).text = msg
                            acc.add(key)

            return _xml_ok(root)
        case _:
            return Response(status_code=HTTPStatus.BAD_REQUEST)
