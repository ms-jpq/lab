from os import environ

from aws_lambda_powertools.utilities.data_classes import (
    EventBridgeEvent,
    event_source,
)
from aws_lambda_powertools.utilities.typing import LambdaContext

from .. import SESSION, _
from ..telemetry import entry


@event_source(data_class=EventBridgeEvent)
@entry()
def main(event: EventBridgeEvent, _: LambdaContext) -> None:
    url = environ["ENV_MINIFLUX_ENDPOINT"] + "feeds/refresh"
    headers = {"X-Auth-Token": environ["ENV_MINIFLUX_KEY"]}

    with SESSION.put(url, headers=headers) as rsp:
        assert rsp.status_code in range(200, 300), (url, rsp.status_code, rsp.content)
