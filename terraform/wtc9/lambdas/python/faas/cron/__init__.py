from os import environ

from aws_lambda_powertools.utilities.data_classes import (
    EventBridgeEvent,
    event_source,
)
from aws_lambda_powertools.utilities.typing import LambdaContext

from .. import SESSION, _
from ..telemetry import entry


def _miniflux() -> None:
    url = environ["ENV_MINIFLUX_ENDPOINT"] + "feeds/refresh"
    headers = {"X-Auth-Token": environ["ENV_MINIFLUX_KEY"]}

    with SESSION.put(url, headers=headers) as r:
        assert r.ok, (url, r.status_code, r.content)


@event_source(data_class=EventBridgeEvent)
@entry()
def main(event: EventBridgeEvent, _: LambdaContext) -> None:
    match event.raw_event:
        case {"label": "miniflux"}:
            _miniflux()
        case _:
            assert False, event.raw_event
