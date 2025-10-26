from collections.abc import Iterator
from contextlib import contextmanager, nullcontext
from logging import INFO, captureWarnings, getLogger

from aws_lambda_powertools.utilities.batch.types import PartialItemFailureResponse
from aws_lambda_powertools.utilities.data_classes import SQSEvent, event_source
from aws_lambda_powertools.utilities.typing import LambdaContext

with nullcontext():
    captureWarnings(True)
    getLogger().setLevel(INFO)


@contextmanager
def _main() -> Iterator[None]:
    getLogger().info("%s", ">>> >>> >>>")
    try:
        yield
    finally:
        getLogger().info("%s", "<<< <<< <<<")


@event_source(data_class=SQSEvent)
def main(event: SQSEvent, _: LambdaContext) -> PartialItemFailureResponse:

    with _main():
        for record in event.records:
            getLogger().info("%s", record.message_id)

        return {"batchItemFailures": []}
