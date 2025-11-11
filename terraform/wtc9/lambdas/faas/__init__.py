from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager, nullcontext
from functools import cache
from json import dumps
from logging import INFO, captureWarnings, getLogger
from typing import Any

from botocore.config import Config

with nullcontext():
    captureWarnings(True)
    getLogger().setLevel(INFO)

    _ = True

with nullcontext():
    B3_CONF = Config(retries={"mode": "adaptive"})


@cache
def executor() -> ThreadPoolExecutor:
    return ThreadPoolExecutor()


@contextmanager
def log_span() -> Iterator[None]:
    getLogger().info("%s", ">>>")
    try:
        yield None
    finally:
        getLogger().info("%s", "<<<")


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
