from collections import ChainMap
from collections.abc import Mapping
from contextlib import nullcontext
from functools import cache
from http import HTTPStatus
from re import sub
from urllib.parse import urlsplit, urlunsplit

from aws_lambda_powertools.event_handler import APIGatewayHttpResolver
from aws_lambda_powertools.event_handler.api_gateway import Response

with nullcontext():
    app = APIGatewayHttpResolver()


@cache
def _mappings() -> Mapping[str, str]:
    mappings: Mapping[str, str] = {}
    return ChainMap(mappings, {v: k for k, v in mappings.items()})


@app.get("/owncloud/.+")
def owncloud() -> Response[str]:
    raw = (
        app.current_event.path.removeprefix("/owncloud/")
        + "?"
        + app.current_event.raw_query_string
    )
    subbed = sub(r"(\w+):/", r"\1://", raw)

    try:
        url = urlsplit(subbed)
    except ValueError as e:
        return Response(status_code=HTTPStatus.BAD_REQUEST, body=str(e))

    netloc = _mappings().get(url.netloc, url.netloc)
    location = urlunsplit((url.scheme, netloc, url.path, url.query, url.fragment))
    return Response(
        status_code=HTTPStatus.TEMPORARY_REDIRECT,
        headers={"Location": location},
        body=location,
    )
