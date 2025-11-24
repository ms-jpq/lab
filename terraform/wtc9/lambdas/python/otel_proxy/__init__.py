from contextlib import contextmanager, nullcontext
from functools import cache
from http import HTTPStatus
from http.client import HTTPMessage
from http.server import BaseHTTPRequestHandler, HTTPServer, ThreadingHTTPServer
from logging import INFO, basicConfig, captureWarnings, getLogger
from os import environ, linesep
from queue import SimpleQueue
from urllib.parse import SplitResult, urlsplit, urlunsplit

from requests import Session
from typing_extensions import Iterator

_Q = SimpleQueue[tuple[str, HTTPMessage, bytes] | None]


with nullcontext():
    captureWarnings(True)
    basicConfig(format="%(message)s", level=INFO, force=True)


with nullcontext():
    SESSION = Session()


@cache
def _otel_httpbased() -> SplitResult:
    env = environ["OTEL_EXP_OTLP_ENDPOINT"]
    return urlsplit(env)


@cache
def queue() -> _Q:
    return _Q()


@contextmanager
def _responding(self: BaseHTTPRequestHandler) -> Iterator[None]:
    try:
        yield None
    except Exception as e1:
        try:
            self.send_response(HTTPStatus.INTERNAL_SERVER_ERROR)
        except Exception as e2:
            name = linesep.join(map(str, (e1, e2)))
            raise ExceptionGroup(name, (e1, e2)) from e1
        else:
            raise e1
    else:
        self.send_response(HTTPStatus.OK)
    finally:
        self.end_headers()


def _read_body(self: BaseHTTPRequestHandler) -> bytes:
    if length := self.headers.get("content-length"):
        return self.rfile.read(int(length))
    else:
        return b""


class _Handler(BaseHTTPRequestHandler):
    def log_request(self, code: int | str = "-", size: int | str = "-") -> None: ...

    def do_POST(self) -> None:
        with _responding(self):
            assert isinstance(self.headers, HTTPMessage)
            body = _read_body(self)
            req = (self.path, self.headers, body)
            assert body
            queue().put_nowait(req)


def loop() -> None:
    q, split = queue(), _otel_httpbased()
    auth = (split.username or "", split.password or "")
    while row := q.get():
        path, headers, body = row
        try:
            url = urlunsplit(split) + path
            h = {
                k: v
                for k, v in ((k.casefold(), v) for k, v in headers.items())
                if k not in {"host", "content-length"}
            }
            getLogger().info("%s", h)
            with SESSION.post(url, headers=h, auth=auth, data=body, timeout=2.0) as r:
                getLogger().info(
                    "%s", (r.request.url, r.request.headers, r.request.body)
                )

                assert r.status_code == HTTPStatus.OK, (r.status_code, r.text)
                getLogger().info("%s", (r.headers, r.text))
        except Exception as e:
            getLogger().error("%s", e)

    assert q.empty(), q.get_nowait()


def srv() -> HTTPServer:
    return ThreadingHTTPServer(("localhost", 4318), _Handler)
