from contextlib import nullcontext
from logging import INFO, captureWarnings, getLogger

from aws_lambda_powertools.utilities.batch.types import PartialItemFailureResponse
from aws_lambda_powertools.utilities.data_classes import SQSEvent, event_source
from aws_lambda_powertools.utilities.typing import LambdaContext

with nullcontext():
    captureWarnings(True)
    getLogger().setLevel(INFO)


@event_source(data_class=SQSEvent)
def main(event: SQSEvent, _: LambdaContext) -> PartialItemFailureResponse:
    for record in event.records:
        getLogger().info("%s", record.message_id)

    return {"batchItemFailures": []}
