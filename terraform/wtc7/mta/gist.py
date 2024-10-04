from collections.abc import Sequence
from http.client import HTTPResponse
from importlib.abc import Loader, MetaPathFinder
from importlib.machinery import ModuleSpec
from importlib.util import LazyLoader, spec_from_loader
from logging import getLogger
from sys import meta_path
from types import ModuleType
from typing import cast
from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit
from urllib.request import build_opener
from uuid import uuid4


def register(name: str, uri: str, timeout: float) -> None:
    scheme, netloc, path, query, frag = urlsplit(uri)
    qs = parse_qs(query)

    def get() -> bytes:
        opener = build_opener()
        nxt_qs = urlencode({**qs, uuid4().hex: (uuid4().hex,)})
        nxt_uri = urlunsplit((scheme, netloc, path, nxt_qs, frag))

        with opener.open(nxt_uri, timeout=timeout) as req:
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

            if target:
                target.__dict__.clear()

            class _Loader(Loader):
                def create_module(self, spec: ModuleSpec) -> ModuleType | None:
                    return target

                def exec_module(self, module: ModuleType) -> None:
                    src = get()
                    code = compile(src, fullname, "exec")
                    exec(code, module.__dict__)
                    getLogger().info("%s", f"***{name}***")

            loader = LazyLoader.factory(cast(Loader, _Loader))
            spec = spec_from_loader(fullname, loader())
            return spec

    meta_path.append(_Finder())
