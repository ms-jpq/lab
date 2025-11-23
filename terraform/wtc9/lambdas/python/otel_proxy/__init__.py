from collections.abc import Sequence
from concurrent.futures import ThreadPoolExecutor
from contextlib import suppress
from http import HTTPStatus
from http.server import ThreadingHTTPServer
from socket import IPPROTO_IPV6, IPV6_V6ONLY, AddressFamily, getfqdn
from socketserver import TCPServer


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
