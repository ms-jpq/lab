from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager, nullcontext
from functools import cache
from logging import INFO, captureWarnings, getLogger

with nullcontext():
    captureWarnings(True)
    getLogger().setLevel(INFO)

    _ = True


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
