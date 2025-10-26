from collections.abc import Mapping
from logging import getLogger
from typing import Any

from aws_lambda_powertools.utilities.data_classes import (
    LambdaFunctionUrlEvent,
    event_source,
)
from aws_lambda_powertools.utilities.typing import LambdaContext


@event_source(data_class=LambdaFunctionUrlEvent)
def main(event: LambdaFunctionUrlEvent, _: LambdaContext) -> Mapping[str, Any]:
    getLogger().info("%s", ">>> >>> >>>")
    getLogger().info("%s", event.headers)

    return {"isAuthorized": True, "context": {}}
