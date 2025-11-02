from collections.abc import Callable
from contextlib import nullcontext
from functools import wraps
from json import dumps
from typing import TypeVar, cast
from urllib.parse import urlunsplit
from uuid import uuid4

from aws_lambda_powertools.event_handler import APIGatewayHttpResolver
from boto3 import client  # pyright:ignore

with nullcontext():
    _UUID = uuid4().hex
    _T = TypeVar("_T")

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
    dynamodb = client(service_name="dynamodb")


def compute_once(fn: Callable[[], _T]) -> Callable[[], _T]:
    @wraps(fn)
    def cont() -> _T:
        f_id = f"{_UUID}-{id(fn)}"

        if f_id not in app.current_event.raw_event:
            app.current_event.raw_event[f_id] = fn()

        return cast(_T, app.current_event.raw_event[f_id])

    return cont


def current_raw_uri() -> str:
    uri = urlunsplit(
        (
            app.current_event.headers.get("x-forwarded-proto", "https"),
            app.current_event.request_context.domain_name,
            app.current_event.raw_path,
            app.current_event.raw_query_string,
            "",
        )
    )
    return uri


from . import echo, owncloud, twilio

assert echo
assert owncloud
assert twilio
