from collections.abc import Sequence
from http.client import HTTPResponse
from importlib.abc import Loader, MetaPathFinder
from importlib.machinery import ModuleSpec
from importlib.util import LazyLoader, spec_from_loader
from sys import meta_path
from types import ModuleType
from typing import cast
from urllib.request import build_opener


def register(name: str, uri: str, timeout: float) -> None:
    def get() -> bytes:
        opener = build_opener()
        with opener.open(uri, timeout=timeout) as req:
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

            loader = LazyLoader.factory(cast(Loader, _Loader))
            spec = spec_from_loader(fullname, loader())
            return spec

    meta_path.append(_Finder())
