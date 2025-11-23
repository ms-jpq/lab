from contextlib import contextmanager
from functools import cache
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from os import linesep
from queue import SimpleQueue
from socket import IPPROTO_IPV6, IPV6_V6ONLY, AddressFamily, getfqdn
from socketserver import TCPServer

from typing_extensions import Iterator


@cache
def queue() -> SimpleQueue[tuple[str, str]]:
    return SimpleQueue()


class Server(ThreadingHTTPServer):
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


class _Handler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:
        with _responding(self):
            row = {}
            queue().put_nowait(row)


srv = Server(("", 4318), _Handler)
