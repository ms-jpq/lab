#!/usr/bin/env -S -- PYTHONSAFEPATH= python3

from base64 import b64decode, b64encode
from contextlib import suppress
from hashlib import blake2b
from hmac import compare_digest
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import PurePosixPath
from posixpath import sep
from socketserver import UnixStreamServer
from typing import Any

_POSIX_ROOT = PurePosixPath(sep)


class _Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        self.flush_headers()
        self.wfile.write(b"Hello, world!")

    def log_message(self, format: str, *args: Any) -> None:
        ...


class _Server(ThreadingHTTPServer, UnixStreamServer):
    allow_reuse_address = True

    def server_bind(self) -> None:
        UnixStreamServer.server_bind(self)


with suppress(KeyboardInterrupt):
    srv = _Server("./owo.sock", _Handler)
    srv.serve_forever()
