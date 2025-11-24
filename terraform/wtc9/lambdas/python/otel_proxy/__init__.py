from collections.abc import Iterator
from concurrent.futures import Executor
from contextlib import contextmanager, nullcontext
from functools import cache, partial
from http import HTTPStatus
from http.client import HTTPMessage
from http.server import BaseHTTPRequestHandler, HTTPServer, ThreadingHTTPServer
from logging import INFO, basicConfig, captureWarnings, getLogger
from os import environ, linesep
from typing import Type
from urllib.parse import SplitResult, urlsplit, urlunsplit

from requests import Session

from .spanning import spanning

with nullcontext():
    captureWarnings(True)
    basicConfig(format="%(message)s", level=INFO, force=True)


with nullcontext():
    SESSION = Session()


@cache
def _otel_httpbased() -> SplitResult:
    env = environ["OTEL_EXP_OTLP_ENDPOINT"]
    return urlsplit(env)


@contextmanager
def _responding(self: BaseHTTPRequestHandler) -> Iterator[None]:
    try:
        yield None
    except Exception:
        self.send_response(HTTPStatus.INTERNAL_SERVER_ERROR)
        raise
    else:
        self.send_response(HTTPStatus.OK)
    finally:
        self.send_header("content-length", "0")
        self.send_header("connection", "keep-alive")
        self.end_headers()

    assert not self.close_connection


def _proxy(path: str, headers: HTTPMessage, body: bytes) -> None:
    with spanning("<> "):
        try:
            split = _otel_httpbased()
            url = urlunsplit(split) + path
            h = {"content-type": headers["content-type"]}

            with SESSION.post(url, headers=h, data=body) as r:
                assert r.status_code == HTTPStatus.OK, (r.status_code, r.text)
        except Exception as e:
            getLogger().error("%s", e)
        else:
            getLogger().info("%s", f"--> {path}")


def _handler(ex: Executor) -> Type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        def log_request(self, code: int | str = "-", size: int | str = "-") -> None: ...

        def do_POST(self) -> None:
            with spanning(">>>"):
                with _responding(self):
                    assert isinstance(self.headers, HTTPMessage)
                    assert (length := self.headers.get("content-length"))
                    assert (body := self.rfile.read(int(length)))

                    p = partial(_proxy, path=self.path, headers=self.headers, body=body)

                ex.submit(p)

    return Handler


def srv(ex: Executor) -> HTTPServer:
    return ThreadingHTTPServer(("localhost", 4318), _handler(ex))
