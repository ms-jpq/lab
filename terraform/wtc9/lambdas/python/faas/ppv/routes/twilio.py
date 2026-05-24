from asyncio import gather, to_thread
from collections import defaultdict
from collections.abc import Awaitable, Callable, Mapping, MutableSet, Sequence, Set
from datetime import datetime, timedelta, timezone
from functools import cache
from http import HTTPStatus
from itertools import chain
from json import loads
from os import environ
from xml.etree.ElementTree import Element, SubElement, indent, tostring

from aws_lambda_powertools.event_handler import APIGatewayHttpResolver
from aws_lambda_powertools.event_handler.api_gateway import Response
from opentelemetry.trace import get_current_span

from ... import suppress_exn
from ...twilio import parse_params, verify
from . import TRACER, app, compute_once, current_raw_uri, dynamodb

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


async def _auth(
    app: APIGatewayHttpResolver,
    next_middleware: Callable[[APIGatewayHttpResolver], Awaitable[Response[None]]],
) -> Response[None]:
    with TRACER.start_as_current_span("hmac middleware"):
        event = app.current_event
        if not (signature := event.headers.get("x-twilio-signature")):
            return Response(status_code=HTTPStatus.UNAUTHORIZED)

        if not verify(current_raw_uri(), params=_current_params(), signature=signature):
            return Response(status_code=HTTPStatus.FORBIDDEN)

        return await next_middleware(app)


def _xml_ok(el: Element) -> Response[str]:
    indent(el)
    body = tostring(el, encoding="unicode", xml_declaration=True)
    get_current_span().add_event("rsp", attributes={"xml": body})
    return Response(
        status_code=HTTPStatus.OK,
        headers={"content-type": "application/xml"},
        body=body,
    )


@app.post("/twilio/voice", middlewares=[_auth])
async def voice() -> Response[str]:
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


async def _upsert_reply_to(dst: str, route_to: str, reply_to: str) -> None:
    id = _id(dst, route_to=route_to)
    ttl = int((datetime.now(tz=timezone.utc) + timedelta(hours=8)).timestamp())
    with suppress_exn():
        await to_thread(
            dynamodb.put_item,
            TableName=_table(),
            Item={
                "ID": {"S": id},
                "TTL": {"N": str(ttl)},
                "Reply-To": {"S": reply_to},
            },
        )


async def _retrieve_reply_to(dst: str, route_to: str) -> str | None:
    id = _id(dst, route_to=route_to)
    with suppress_exn():
        rsp = await to_thread(
            dynamodb.get_item,
            TableName=_table(),
            Key={"ID": {"S": id}},
        )
        match rsp:
            case {"Item": {"Reply-To": {"S": str(prev_reply_to)}}}:
                return prev_reply_to

    return None


async def _messages(src: str, dst: str, body: str, route_to: str) -> _Routed:
    span = get_current_span()
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
        span.add_event(
            "received.privileged.instruction", attributes={"route_to": route_to}
        )
        if question:
            span.add_event("received.question")

            if prev_reply_to := await _retrieve_reply_to(dst=dst, route_to=route_to):
                await _upsert_reply_to(
                    dst=dst, route_to=route_to, reply_to=prev_reply_to
                )

            return ((route_to, (prefix_2 + str(prev_reply_to),)),)
        elif instruction:
            set_reply_to = body.removeprefix(prefix_1).removeprefix(prefix_2)
            span.add_event(
                "received.next.number.for.reply", attributes={"next": set_reply_to}
            )

            await _upsert_reply_to(dst=dst, route_to=route_to, reply_to=set_reply_to)
            return ((route_to, (f"*** {set_reply_to}",)),)
        elif prev_reply_to := await _retrieve_reply_to(dst=dst, route_to=route_to):
            span.add_event(
                "found.previous.number.for.reply",
                attributes={"previous": prev_reply_to},
            )

            await _upsert_reply_to(dst=dst, route_to=route_to, reply_to=prev_reply_to)

            return ((route_to, (prefix_2 + prev_reply_to,)), (prev_reply_to, (body,)))
        else:
            span.add_event("not.found.previous.number.for.reply")

            others = tuple(prefix_1 + tel for tel in (_routes() - {route_to}))
            return ((route_to, others),)
    elif src in _routes() and (question or instruction):
        span.add_event(
            "received.instruction.from.another.privileged.number",
            attributes={"other_number": src},
        )

        return ()
    else:
        span.add_event(
            "received.text.from.arbitrary.number",
            attributes={"arbitrary_number": route_to},
        )

        reply_to = src
        await _upsert_reply_to(dst=dst, route_to=route_to, reply_to=reply_to)

        return ((route_to, (prefix_1 + reply_to, body)),)


@app.post("/twilio/message", middlewares=[_auth])
async def message() -> Response[str]:
    root = Element("Response")

    match _current_params():
        case {"From": src, "To": dst, "Body": body}:
            """
            dst is always a twilio number
            """

            async def cont(route_to: str) -> _Routed:
                with TRACER.start_as_current_span(
                    "calc routing", attributes={"src": src, "dst": dst}
                ):
                    return await _messages(src, dst=dst, body=body, route_to=route_to)

            mapped = await gather(*(cont(route_to) for route_to in _routes()))

            seen: Mapping[str, MutableSet[int]] = defaultdict(set)
            for tel, msgs in chain.from_iterable(mapped):
                acc = seen[tel]
                for msg in msgs:
                    if not (key := hash(msg)) in acc:
                        SubElement(root, "Message", attrib={"to": tel}).text = msg
                        acc.add(key)

            return _xml_ok(root)
        case _:
            return Response(status_code=HTTPStatus.BAD_REQUEST)
