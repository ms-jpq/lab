from collections.abc import Sequence
from contextlib import nullcontext
from importlib.abc import InspectLoader, Loader, MetaPathFinder, SourceLoader
from importlib.machinery import ModuleSpec
from importlib.util import LazyLoader, spec_from_loader
from inspect import getsourcelines
from pathlib import PurePath
from sys import meta_path
from threading import RLock
from types import CodeType, ModuleType
from typing import cast
from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit
from uuid import uuid4

from opentelemetry.trace import get_current_span, get_tracer
from requests import Session

with nullcontext():
    _TRACER = get_tracer(__name__)
    _NS = PurePath(uuid4().hex)


def register(name: str, uri: str, timeout: float) -> None:
    scheme, netloc, path, query, frag = urlsplit(uri)
    qs = parse_qs(query)
    session = Session()

    def get() -> str:
        nxt_qs = urlencode({**qs, uuid4().hex: (uuid4().hex,)})
        nxt_uri = urlunsplit((scheme, netloc, path, nxt_qs, frag))

        try:
            with session.get(nxt_uri, timeout=timeout) as rsp:
                return rsp.text
        except Exception as e:
            get_current_span().record_exception(e)
            return ""

    class _Finder(MetaPathFinder):
        def find_spec(
            self,
            fullname: str,
            path: Sequence[str] | None = None,
            target: ModuleType | None = None,
        ) -> ModuleSpec | None:
            if fullname != name:
                return None

            lock, cache = RLock(), ""

            class _Loader(SourceLoader):
                def get_filename(self, fullname: str) -> str:
                    return _NS.joinpath(fullname).as_posix()

                def get_data(self, path: str) -> bytes:
                    raise NotImplementedError()

                def get_source(self, fullname: str) -> str:
                    nonlocal cache
                    with _TRACER.start_as_current_span("get src"), lock:
                        return (cache := cache or get())

                def get_code(self, fullname: str) -> CodeType | None:
                    source = self.get_source(fullname)
                    with _TRACER.start_as_current_span("compile code"):
                        return InspectLoader.source_to_code(source)

                def exec_module(self, module: ModuleType) -> None:
                    nonlocal cache
                    with _TRACER.start_as_current_span("re-exec module"), lock:
                        cache = ""
                        module.__file__ = self.get_filename(fullname)

                        assert (compiled := self.get_code(fullname))
                        with _TRACER.start_as_current_span("exec code"):
                            return exec(compiled, module.__dict__)

            loader = LazyLoader.factory(cast(Loader, _Loader))
            spec = spec_from_loader(fullname, loader=loader())
            return spec

    meta_path.append(_Finder())


def traceback(mod: ModuleType, exn: Exception, ctx: int = 6) -> str | None:
    if not (tb := exn.__traceback__):
        return None
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

    return py
