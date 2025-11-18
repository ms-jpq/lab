from collections.abc import Sequence
from contextlib import nullcontext
from http.client import HTTPResponse
from importlib.abc import InspectLoader, Loader, MetaPathFinder, SourceLoader
from importlib.machinery import ModuleSpec
from importlib.util import LazyLoader, spec_from_loader
from inspect import getsourcelines
from logging import getLogger
from pathlib import PurePath
from sys import meta_path
from threading import Lock
from types import CodeType, ModuleType
from typing import cast
from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit
from urllib.request import build_opener
from uuid import uuid4

from opentelemetry.trace import get_tracer
from opentelemetry.trace.propagation import get_current_span

with nullcontext():
    TRACER = get_tracer("mta")
    _NS = PurePath(uuid4().hex)
    _OPENER = build_opener()


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

            lock, cache = Lock(), ""

            class _Loader(SourceLoader):
                def get_filename(self, fullname: str) -> str:
                    return _NS.joinpath(fullname).as_posix()

                def get_data(self, path: str) -> bytes:
                    raise NotImplementedError()

                def get_source(self, fullname: str) -> str:
                    nonlocal cache
                    with TRACER.start_as_current_span("get src"), lock:
                        if not cache:
                            src = get()
                            cache = src.decode()

                        return cache

                def get_code(self, fullname: str) -> CodeType | None:
                    source = self.get_source(fullname)
                    with TRACER.start_as_current_span("compile code"):
                        return InspectLoader.source_to_code(source)

                def exec_module(self, module: ModuleType) -> None:
                    nonlocal cache
                    with TRACER.start_as_current_span("clear cache"), lock:
                        cache = ""
                        module.__file__ = self.get_filename(fullname)

                    assert (compiled := self.get_code(fullname))
                    with TRACER.start_as_current_span("exec code"), lock:
                        exec(compiled, module.__dict__)

            loader = LazyLoader.factory(cast(Loader, _Loader))
            spec = spec_from_loader(fullname, loader=loader())
            return spec

    meta_path.append(_Finder())


def log(mod: ModuleType, exn: Exception, ctx: int = 6) -> None:
    if tb := exn.__traceback__:
        while tb.tb_next:
            tb = tb.tb_next

        lines, offset = getsourcelines(mod)
        lineno = tb.tb_lineno - offset
        lo = max(lineno - ctx - 1, 0)
        hi = min(len(lines), lineno + ctx)
        width = len(str(hi))
        py = "".join(
            f"{'*' if idx == lineno else ' '}{str(idx).rjust(width, '0')} {line}"
            for idx, line in enumerate(lines[lo:hi], start=lo + 1)
        )
        span = get_current_span()
        getLogger().info("%s", span)
        span.set_attribute("traceback", py)
