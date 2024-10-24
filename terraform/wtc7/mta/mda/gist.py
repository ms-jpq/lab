from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from http.client import HTTPResponse
from importlib.abc import InspectLoader, Loader, MetaPathFinder
from importlib.machinery import ModuleSpec
from importlib.util import LazyLoader, spec_from_loader
from logging import getLogger
from os import linesep
from sys import meta_path
from threading import Lock
from time import monotonic
from types import ModuleType
from typing import cast
from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit
from urllib.request import build_opener
from uuid import uuid4

_OPENER = build_opener()


@contextmanager
def benchmark(name: str) -> Iterator[None]:
    t0 = monotonic()
    try:
        yield
    finally:
        getLogger().info("%s", f"((({name}::{monotonic()-t0:.3f})))")


def register(name: str, uri: str, timeout: float) -> None:
    scheme, netloc, path, query, frag = urlsplit(uri)
    qs = parse_qs(query)

    def get() -> bytes:
        nxt_qs = urlencode({**qs, uuid4().hex: (uuid4().hex,)})
        nxt_uri = urlunsplit((scheme, netloc, path, nxt_qs, frag))

        with _OPENER.open(nxt_uri, timeout=timeout) as req:
            assert isinstance(req, HTTPResponse)
            return req.read()

    class _Finder(MetaPathFinder):
        def find_spec(
            self,
            fullname: str,
            path: Sequence[str] | None = None,
            target: ModuleType | None = None,
        ) -> ModuleSpec | None:
            if fullname != name:
                return None

            code, lock = "", Lock()

            class _Loader(InspectLoader):

                def create_module(self, spec: ModuleSpec) -> ModuleType | None:
                    nonlocal code
                    with lock:
                        code = ""
                    if target:
                        target.__dict__.clear()
                    return target

                def get_source(self, fullname: str) -> str:
                    nonlocal code
                    with lock:
                        if not code:
                            with benchmark("get"):
                                src = get()
                            code = src.decode()
                        return code

                def exec_module(self, module: ModuleType) -> None:
                    with benchmark("compile"):
                        code = self.get_code(fullname)
                        assert code
                        exec(code, module.__dict__)

            loader = LazyLoader.factory(cast(Loader, _Loader))
            spec = spec_from_loader(fullname, loader())
            return spec

    meta_path.append(_Finder())


def log(mod: ModuleType, exn: Exception, ctx: int = 6) -> None:
    if isinstance(loader := mod.__loader__, InspectLoader) and (
        tb := exn.__traceback__
    ):
        while tb.tb_next:
            tb = tb.tb_next
        lineno = tb.tb_lineno

        if lines := (loader.get_source(mod.__name__) or "").splitlines():
            lo = max(lineno - ctx - 1, 0)
            hi = min(len(lines), lineno + ctx)
            width = len(str(hi))
            py = linesep.join(
                f"{'*' if idx == lineno else ' '}{str(idx).rjust(width, '0')} {line}"
                for idx, line in enumerate(lines[lo:hi], start=lo + 1)
            )
            getLogger().warning("%s", linesep + py)
