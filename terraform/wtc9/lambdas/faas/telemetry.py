from collections.abc import Callable, Iterator
from concurrent.futures import ThreadPoolExecutor
from contextlib import AbstractContextManager, contextmanager, nullcontext
from functools import wraps
from logging import INFO, basicConfig, captureWarnings
from os import environ
from pathlib import PurePath
from typing import Any

from opentelemetry._logs import set_logger_provider
from opentelemetry.context import Context, attach, detach, get_current
from opentelemetry.exporter.otlp.proto.http._log_exporter import OTLPLogExporter
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.botocore import BotocoreInstrumentor
from opentelemetry.sdk._logs import LoggerProvider, LoggingHandler
from opentelemetry.sdk._logs.export import BatchLogRecordProcessor
from opentelemetry.sdk.resources import (
    Resource,
    ResourceDetector,
    get_aggregated_resources,
)
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.semconv._incubating.attributes.cloud_attributes import (
    CLOUD_PROVIDER,
    CLOUD_REGION,
)
from opentelemetry.semconv._incubating.attributes.faas_attributes import (
    FAAS_INSTANCE,
    FAAS_NAME,
    FAAS_VERSION,
)
from opentelemetry.semconv.attributes.service_attributes import SERVICE_NAME
from opentelemetry.trace import set_tracer_provider

with nullcontext():

    class _detector(ResourceDetector):
        def detect(self) -> Resource:
            return Resource(
                {
                    CLOUD_PROVIDER: "aws",
                    CLOUD_REGION: environ["AWS_REGION"],
                    FAAS_INSTANCE: environ["AWS_LAMBDA_LOG_STREAM_NAME"],
                    FAAS_NAME: environ["AWS_LAMBDA_FUNCTION_NAME"],
                    FAAS_VERSION: environ["AWS_LAMBDA_FUNCTION_VERSION"],
                    SERVICE_NAME: PurePath(__file__).parent.name,
                }
            )

    _resource = get_aggregated_resources(detectors=[_detector()])
    _ex = ThreadPoolExecutor()


with nullcontext():
    captureWarnings(True)

    _lp = LoggerProvider(resource=_resource)
    _lp.add_log_record_processor(BatchLogRecordProcessor(OTLPLogExporter()))
    set_logger_provider(_lp)

    basicConfig(
        format="%(message)s",
        level=INFO,
        handlers=(LoggingHandler(logger_provider=_lp),),
    )


with nullcontext():
    _tp = TracerProvider(resource=_resource)
    _tp.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
    set_tracer_provider(_tp)


with nullcontext():
    BotocoreInstrumentor().instrument()  # type:ignore


def with_context() -> Callable[[], AbstractContextManager[Context]]:
    ctx = get_current()

    @contextmanager
    def cont() -> Iterator[Context]:
        token = attach(ctx)
        try:
            yield ctx
        finally:
            detach(token)

    return cont


def flush_otlp(f: Callable[..., Any]) -> Callable[..., Any]:
    @wraps(f)
    def cont(*__args: Any, **__kwargs: Any) -> Any:
        try:
            return f(*__args, **__kwargs)
        finally:
            for p in (_tp, _lp):
                _ex.submit(p.force_flush)

    return cont


__ = True
