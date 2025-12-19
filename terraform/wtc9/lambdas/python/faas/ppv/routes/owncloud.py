from collections import ChainMap
from collections.abc import Mapping, MutableMapping
from contextlib import nullcontext
from functools import cache
from http import HTTPStatus
from os import environ
from re import sub
from urllib.parse import urlsplit, urlunsplit

from aws_lambda_powertools.event_handler.api_gateway import Response

from . import TRACER, app

with nullcontext():
    _ARCHIVE = "archive.ph"


@cache
def _mappings() -> Mapping[str, str]:
    if (domain := environ.get("ENV_DOMAIN")) is None:
        return {}

    mappings: MutableMapping[str, str] = {
        "m.youtube.com": f"youku.{domain}",
        "mobile.twitter.com": f"xcancel.com",
        "old.reddit.com": f"bbs.{domain}",
        "reddit.com": f"bbs.{domain}",
        "www.google.ca": f"ask.{domain}",
        "www.google.com": f"ask.{domain}",
        "www.reddit.com": f"bbs.{domain}",
        "x.com": f"xcancel.com",
        "youtube.com": f"youku.{domain}",
    }
    return ChainMap(mappings, {v: k for k, v in mappings.items()})


@app.get("/owncloud/.+")
def route() -> Response[str]:
    with TRACER.start_as_current_span("redirect") as span:
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
            split = ("https", _ARCHIVE, "/" + urlunsplit(url), "", "")

        location = urlunsplit(split)
        span.add_event("redirect.to", attributes={"location": location})
        return Response(
            status_code=HTTPStatus.TEMPORARY_REDIRECT,
            headers={"Location": location},
            body=location,
        )
