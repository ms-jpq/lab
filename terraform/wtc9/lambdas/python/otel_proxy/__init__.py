from contextlib import contextmanager, nullcontext
from functools import cache
from http import HTTPStatus
from http.client import HTTPMessage
from http.server import BaseHTTPRequestHandler, HTTPServer, ThreadingHTTPServer
from logging import INFO, basicConfig, captureWarnings, getLogger
from os import environ, linesep
from queue import SimpleQueue
from socket import IPPROTO_IPV6, IPV6_V6ONLY, AddressFamily, getfqdn
from socketserver import TCPServer

from requests import Session
from typing_extensions import Iterator

_Q = SimpleQueue[tuple[str, HTTPMessage, bytes]]


with nullcontext():
    captureWarnings(True)
    basicConfig(format="%(message)s", level=INFO, force=True)


with nullcontext():
    SESSION = Session()


@cache
def _otel_httpbased() -> str:
    return environ["OTEL_EXP_OTLP_ENDPOINT"]


@cache
def _queue() -> _Q:
    return _Q()


class _Server(ThreadingHTTPServer):
    address_family = AddressFamily.AF_INET6
    allow_reuse_address = True
    allow_reuse_port = True

    def server_bind(self) -> None:
        self.socket.setsockopt(IPPROTO_IPV6, IPV6_V6ONLY, 0)
        TCPServer.server_bind(self)
        _, server_port, *_ = self.socket.getsockname()
        self.server_name = getfqdn()
        self.server_port = server_port


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


def _read_body(self: BaseHTTPRequestHandler) -> bytes:
    if length := self.headers.get("content-length"):
        return self.rfile.read(int(length))
    else:
        return b""


class _Handler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:
        with _responding(self):
            assert isinstance(self.headers, HTTPMessage)
            body = _read_body(self)
            req = (self.path, self.headers, body)
            _queue().put_nowait(req)


def loop() -> None:
    while True:
        path, headers, body = _queue().get()
        try:
            url = _otel_httpbased() + path
            h = {k: v for k, v in headers.items()}
            with SESSION.post(url, headers=h, data=body):
                pass
        except Exception as e:
            getLogger().error("%s", e)


def srv() -> HTTPServer:
    return _Server(("", 4318), _Handler)
