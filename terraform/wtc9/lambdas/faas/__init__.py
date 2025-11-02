from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from functools import cache
from logging import getLogger


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
