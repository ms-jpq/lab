from collections.abc import Callable
from contextlib import nullcontext
from functools import wraps
from http.cookies import SimpleCookie
from json import dumps
from typing import TypeVar, cast
from urllib.parse import urlunsplit
from uuid import uuid4

from aws_lambda_powertools.event_handler import APIGatewayHttpResolver
from boto3 import client  # pyright:ignore
from botocore.config import Config

with nullcontext():
    _T = TypeVar("_T")
    _UUID = uuid4().hex
    _B3_CONF = Config(retries={"mode": "adaptive"})

    app = APIGatewayHttpResolver(
        serializer=lambda d: dumps(
            d,
            check_circular=False,
            ensure_ascii=False,
            allow_nan=False,
            indent=2,
            sort_keys=True,
        )
    )
    dynamodb = client(service_name="dynamodb", config=_B3_CONF)
    sns = client(service_name="sns", config=_B3_CONF)


def compute_once(fn: Callable[[], _T]) -> Callable[[], _T]:
    f_id = f"{_UUID}-{id(fn)}"

    @wraps(fn)
    def cont() -> _T:
        if f_id not in app.current_event.raw_event:
            app.current_event.raw_event[f_id] = fn()

        return cast(_T, app.current_event.raw_event[f_id])

    return cont


@compute_once
def current_raw_uri() -> str:
    event = app.current_event
    uri = urlunsplit(
        (
            event.headers.get("x-forwarded-proto", "https"),
            event.request_context.domain_name,
            event.raw_path,
            event.raw_query_string,
            "",
        )
    )
    return uri


@compute_once
def current_cookies() -> SimpleCookie:
    cookie = SimpleCookie()
    for c in app.current_event.cookies:
        cookie.load(c)
    return cookie


from . import echo, owncloud, twilio

assert echo
assert owncloud
assert twilio
