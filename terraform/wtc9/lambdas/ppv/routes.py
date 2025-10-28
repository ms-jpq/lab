from collections import ChainMap
from collections.abc import Mapping, MutableMapping
from contextlib import nullcontext
from functools import cache
from http import HTTPStatus
from os import environ
from re import sub
from urllib.parse import urlsplit, urlunsplit

from aws_lambda_powertools.event_handler import APIGatewayHttpResolver
from aws_lambda_powertools.event_handler.api_gateway import Response

with nullcontext():
    app = APIGatewayHttpResolver()

    _ARCHIVE = environ.get("ARCHIVE", "archive.is")


@cache
def _mappings() -> Mapping[str, str]:
    mappings: MutableMapping[str, str] = {}
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

    if newloc := _mappings().get(url.netloc):
        split = (url.scheme, newloc, url.path, url.query, url.fragment)
    else:
        split = ("https://", _ARCHIVE, "/" + urlunsplit(url), "", "")

    location = urlunsplit(split)
    return Response(
        status_code=HTTPStatus.TEMPORARY_REDIRECT,
        headers={"Location": location},
        body=location,
    )
