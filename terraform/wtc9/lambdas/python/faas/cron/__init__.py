from contextlib import nullcontext
from os import environ

from aws_lambda_powertools.utilities.data_classes import (
    EventBridgeEvent,
    event_source,
)
from aws_lambda_powertools.utilities.typing import LambdaContext
from requests import Session

from .. import _
from ..telemetry import entry

with nullcontext():
    _SESSION = Session()


@event_source(data_class=EventBridgeEvent)
@entry()
def main(event: EventBridgeEvent, _: LambdaContext) -> None:
    url = environ["ENV_MINIFLUX_ENDPOINT"] + "feeds/refresh"
    headers = {"X-Auth-Token": environ["ENV_MINIFLUX_KEY"]}

    with _SESSION.put(url, headers=headers) as rsp:
        assert rsp.status_code in range(200, 300), (url, rsp.status_code, rsp.content)
