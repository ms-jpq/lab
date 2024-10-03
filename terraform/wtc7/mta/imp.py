from collections.abc import MutableSequence, Sequence
from functools import cache
from http.client import HTTPResponse
from importlib.abc import Loader, MetaPathFinder
from importlib.machinery import ModuleSpec
from os import linesep
from types import ModuleType
from urllib.request import build_opener

TIMEOUT = 6.9


@cache
def _script(uri: str) -> str:
    opener = build_opener()
    errs: MutableSequence[Exception] = []
    for _ in range(3):
        try:
            with opener.open(uri, timeout=TIMEOUT) as req:
                assert isinstance(req, HTTPResponse)
                return req.read().decode()
        except Exception as exn:
            errs.append(exn)
    else:
        msg = linesep.join(map(str, errs))
        *_, e = errs
        raise ExceptionGroup(msg, errs) from e


class _Loader(Loader):
    def create_module(self, spec: ModuleSpec) -> ModuleType | None:
        return None

    def exec_module(self, module: ModuleType) -> None:
        pass


class _Finder(MetaPathFinder):
    def find_spec(
        self,
        fullname: str,
        path: Sequence[str] | None = None,
        target: ModuleType | None = None,
    ) -> ModuleSpec | None:
        return None
