from contextlib import nullcontext

from aws_lambda_powertools.event_handler import APIGatewayHttpResolver
from aws_lambda_powertools.event_handler.api_gateway import Response

with nullcontext():
    app = APIGatewayHttpResolver()


@app.get("/")
def root() -> Response:
    return Response(status_code=204)
