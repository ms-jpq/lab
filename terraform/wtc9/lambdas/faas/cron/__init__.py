from contextlib import nullcontext

from aws_lambda_powertools.utilities.data_classes import (
    EventBridgeEvent,
    event_source,
)
from aws_lambda_powertools.utilities.typing import LambdaContext
from opentelemetry.instrumentation.aws_lambda import AwsLambdaInstrumentor

from .. import _


@event_source(data_class=EventBridgeEvent)
def main(event: EventBridgeEvent, _: LambdaContext) -> None:
    return


with nullcontext():
    AwsLambdaInstrumentor().instrument()
