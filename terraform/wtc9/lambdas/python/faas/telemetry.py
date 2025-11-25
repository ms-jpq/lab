from collections.abc import Callable
from contextlib import nullcontext
from functools import wraps
from itertools import permutations
from logging import INFO, basicConfig, captureWarnings, getLogger
from os import environ
from pathlib import PurePath
from typing import Any, TypeVar, cast

from aws_lambda_powertools.utilities.data_classes.common import DictWrapper
from aws_lambda_powertools.utilities.typing.lambda_context import LambdaContext
from opentelemetry.context import Context, attach, detach
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.botocore import BotocoreInstrumentor
from opentelemetry.instrumentation.requests import RequestsInstrumentor
from opentelemetry.propagate import extract
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
from opentelemetry.trace import Span, get_tracer, set_tracer_provider

from .spanner import spanning

_F = TypeVar("_F", bound=Callable[..., Any])
_M = TypeVar("_M", bound=Callable[[Any, LambdaContext], Any])


with nullcontext():
    NAME = environ["AWS_LAMBDA_FUNCTION_NAME"]

with nullcontext():
    captureWarnings(True)
    basicConfig(format="%(message)s", level=INFO, force=True)

with nullcontext():

    class _detector(ResourceDetector):
        def detect(self) -> Resource:
            return Resource(
                {
                    CLOUD_PROVIDER: "aws",
                    CLOUD_REGION: environ["AWS_REGION"],
                    FAAS_INSTANCE: environ["AWS_LAMBDA_LOG_STREAM_NAME"],
                    FAAS_NAME: NAME,
                    FAAS_VERSION: environ["AWS_LAMBDA_FUNCTION_VERSION"],
                    SERVICE_NAME: PurePath(__file__).parent.name,
                }
            )

    _resource = get_aggregated_resources(detectors=[_detector()])


with nullcontext():
    _tp = TracerProvider(resource=_resource)
    _tp.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
    set_tracer_provider(_tp)

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


def add_mutual_links(*spans: Span) -> None:
    for l, r in permutations(spans, 2):
        l.add_link(r.get_span_context())


def entry(
    event_context_extractor: Callable[[DictWrapper], Context] | None = None,
) -> Callable[[_M], _M]:
    def cont(f: _F) -> _F:
        @wraps(f)
        def instrumented(event: DictWrapper, context: LambdaContext) -> Any:
            ctx = (
                event_context_extractor(event)
                if event_context_extractor
                else extract(event.raw_event.get("headers", {}))
            )
            r = with_context(ctx)(with_span()(f))
            try:
                return r(event, context)
            finally:
                with spanning("<<<"):
                    try:
                        _tp.force_flush()
                    except Exception as e:
                        getLogger().error("%s", e)

        return cast(_F, instrumented)

    return cont
