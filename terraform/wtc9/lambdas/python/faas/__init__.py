from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager, nullcontext
from functools import cache
from json import dumps
from logging import getLogger
from typing import Any

from botocore.config import Config
from opentelemetry.trace import get_current_span

_ = True

with nullcontext():
    B3_CONF = Config(retries={"mode": "adaptive"})


@cache
def executor() -> ThreadPoolExecutor:
    return ThreadPoolExecutor()


@contextmanager
def suppress_exn() -> Iterator[None]:
    try:
        yield None
    except Exception as e:
        get_current_span().record_exception(e)
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
