from contextlib import nullcontext
from http import HTTPStatus
from re import compile

from aws_lambda_powertools.event_handler import APIGatewayHttpResolver
from aws_lambda_powertools.event_handler.api_gateway import Response

with nullcontext():
    app = APIGatewayHttpResolver()


@app.get("/")
def root() -> Response[None]:
    return Response(status_code=HTTPStatus.NO_CONTENT)


with nullcontext():
    _RE = compile(r"^/owncloud/\w+:/")


@app.get("/owncloud/.+")
def owncloud() -> Response[str]:
    path = _RE.sub("", app.current_event.path)
    query = app.current_event.raw_query_string

    location = "https://" + path + ("?" if query else "") + query
    return Response(
        status_code=HTTPStatus.TEMPORARY_REDIRECT,
        headers={"Location": location},
        body=location,
    )
