from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager, nullcontext
from functools import cache
from json import dumps
from logging import INFO, captureWarnings, getLogger
from typing import Any

from botocore.config import Config
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.botocore import BotocoreInstrumentor
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.trace import set_tracer_provider

with nullcontext():
    captureWarnings(True)
    getLogger().setLevel(INFO)

    _ = True

with nullcontext():
    _provider = TracerProvider()
    _provider.add_span_processor(SimpleSpanProcessor(OTLPSpanExporter()))
    set_tracer_provider(_provider)


with nullcontext():
    BotocoreInstrumentor().instrument()
    B3_CONF = Config(retries={"mode": "adaptive"})


@cache
def executor() -> ThreadPoolExecutor:
    return ThreadPoolExecutor()


@contextmanager
def suppress_exn() -> Iterator[None]:
    try:
        yield None
    except Exception as e:
        getLogger().error("%s", e)


def dump_json(x: Any) -> str:
    return dumps(
        x,
        check_circular=False,
        ensure_ascii=False,
        allow_nan=False,
        indent=2,
        sort_keys=True,
    )
