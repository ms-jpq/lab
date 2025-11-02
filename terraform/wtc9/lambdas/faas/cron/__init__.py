from contextlib import nullcontext
from logging import INFO, captureWarnings, getLogger

from aws_lambda_powertools.utilities.data_classes import (
    EventBridgeEvent,
    event_source,
)
from aws_lambda_powertools.utilities.typing import LambdaContext

with nullcontext():
    captureWarnings(True)
    getLogger().setLevel(INFO)


@event_source(data_class=EventBridgeEvent)
def main(event: EventBridgeEvent, _: LambdaContext) -> None:
    return
