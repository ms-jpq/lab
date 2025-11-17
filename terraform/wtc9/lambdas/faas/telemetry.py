from contextlib import nullcontext
from logging import INFO, captureWarnings, getLogger
from os import environ
from pathlib import PurePath

from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.botocore import BotocoreInstrumentor
from opentelemetry.sdk.resources import (
    Resource,
    ResourceDetector,
    get_aggregated_resources,
)
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
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
    captureWarnings(True)
    getLogger().setLevel(INFO)


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

    _provider = TracerProvider(
        resource=get_aggregated_resources(detectors=[_detector()])
    )
    _provider.add_span_processor(SimpleSpanProcessor(OTLPSpanExporter()))
    set_tracer_provider(_provider)


with nullcontext():
    BotocoreInstrumentor().instrument()


__ = True
