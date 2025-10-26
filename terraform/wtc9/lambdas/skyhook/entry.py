from logging import getLogger

from aws_lambda_powertools.utilities.data_classes import SQSEvent, event_source
from aws_lambda_powertools.utilities.typing import LambdaContext


@event_source(data_class=SQSEvent)
def main(event: SQSEvent, _: LambdaContext) -> None:
    getLogger().info("%s", ">>> >>> >>>")
