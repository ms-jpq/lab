from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from contextlib import nullcontext
from functools import cache, wraps
from logging import INFO, StreamHandler, basicConfig, captureWarnings
from os import environ
from pathlib import PurePath
from typing import Any, TypeVar, cast

from aws_lambda_powertools.utilities.data_classes.common import DictWrapper
from aws_lambda_powertools.utilities.typing.lambda_context import LambdaContext
from opentelemetry._logs import set_logger_provider
from opentelemetry.context import Context, attach, detach
from opentelemetry.exporter.otlp.proto.http._log_exporter import OTLPLogExporter
from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.botocore import BotocoreInstrumentor
from opentelemetry.instrumentation.requests import RequestsInstrumentor
from opentelemetry.metrics import set_meter_provider
from opentelemetry.propagate import extract
from opentelemetry.sdk._logs import LoggerProvider, LoggingHandler
from opentelemetry.sdk._logs.export import BatchLogRecordProcessor
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
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
from opentelemetry.trace import get_tracer, set_tracer_provider

_F = TypeVar("_F", bound=Callable[..., Any])
_D = TypeVar("_D", bound=DictWrapper)
_M = TypeVar("_M", bound=Callable[[DictWrapper, LambdaContext], Any])

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


with nullcontext():
    captureWarnings(True)

    _lp = LoggerProvider(resource=_resource)
    _lp.add_log_record_processor(BatchLogRecordProcessor(OTLPLogExporter()))
    set_logger_provider(_lp)

    basicConfig(
        format="%(message)s",
        level=INFO,
        handlers=(StreamHandler(), LoggingHandler()),
        force=True,
    )


with nullcontext():
    _tp = TracerProvider(resource=_resource)
    _tp.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
    set_tracer_provider(_tp)

with nullcontext():
    _mp = MeterProvider(
        resource=_resource,
        metric_readers=(PeriodicExportingMetricReader(OTLPMetricExporter()),),
    )
    set_meter_provider(_mp)

with nullcontext():
    RequestsInstrumentor().instrument()
    BotocoreInstrumentor().instrument()  # type:ignore


def with_context(ctx: Context) -> Callable[[_F], _F]:
    def cont(f: _F) -> _F:
        @wraps(f)
        def instrumented(*__args: Any, **__kwargs: Any) -> Any:
            token = attach(ctx)
            try:
                return f(*__args, **__kwargs)
            finally:
                detach(token)

        return cast(_F, instrumented)

    return cont


def with_span() -> Callable[[_F], _F]:
    def cont(f: _F) -> _F:
        @wraps(f)
        def instrumented(*__args: Any, **__kwargs: Any) -> Any:
            name = ".".join((f.__module__, f.__name__))
            with get_tracer(f.__module__).start_as_current_span(name):
                return f(*__args, **__kwargs)

        return cast(_F, instrumented)

    return cont


@cache
def _executor() -> ThreadPoolExecutor:
    return ThreadPoolExecutor()


def entry(
    event_context_extractor: Callable[[_D], Context] | None = None,
) -> Callable[[_M], _M]:
    def cont(f: _F) -> _F:
        @wraps(f)
        def instrumented(event: _D, context: LambdaContext) -> Any:
            ctx = (
                event_context_extractor(event)
                if event_context_extractor
                else extract(event.raw_event.get("headers", {}))
            )
            r = with_context(ctx)(with_span()(f))
            try:
                return r(event, context)
            finally:
                tuple(_executor().map(lambda x: x.force_flush(), (_tp, _mp, _lp)))

        return cast(_F, instrumented)

    return cont
