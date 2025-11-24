from collections.abc import Iterator
from contextlib import contextmanager
from logging import getLogger
from time import monotonic


@contextmanager
def spanning(name: str) -> Iterator[None]:
    t0 = monotonic()
    try:
        yield None
    finally:
        s = (monotonic() - t0) * 1000
        getLogger().info("%s", f"{name} {s:.2f}ms")
