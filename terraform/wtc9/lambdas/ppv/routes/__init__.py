from contextlib import nullcontext

from aws_lambda_powertools.event_handler import APIGatewayHttpResolver

with nullcontext():
    app = APIGatewayHttpResolver()

from . import owncloud

assert owncloud
