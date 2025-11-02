from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager, nullcontext
from functools import cache
from logging import getLogger
from urllib.parse import urlunsplit

from aws_lambda_powertools.event_handler import APIGatewayHttpResolver
from aws_lambda_powertools.utilities.data_classes import APIGatewayProxyEventV2
from boto3 import client  # pyright:ignore

with nullcontext():
    app = APIGatewayHttpResolver()
    dynamodb = client(service_name="dynamodb")


@cache
def executor() -> ThreadPoolExecutor:
    return ThreadPoolExecutor()


@contextmanager
def log_span() -> Iterator[None]:
    getLogger().info("%s", ">>>")
    try:
        yield None
    finally:
        getLogger().info("%s", "<<<")


def raw_uri(event: APIGatewayProxyEventV2) -> str:
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


from . import owncloud, twilio

assert owncloud
assert twilio
