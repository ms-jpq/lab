from __future__ import annotations

from collections.abc import Callable, Iterator, Mapping
from contextlib import contextmanager, nullcontext, suppress
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler
from io import BufferedReader
from logging import getLogger
from os import PathLike, killpg, unlink
from pathlib import Path
from signal import SIGKILL, SIGTERM
from socketserver import ThreadingMixIn, UnixStreamServer
from subprocess import DEVNULL, PIPE, Popen
from typing import Any, cast
from urllib.parse import parse_qs, urlsplit

_HandlerFn = Callable[[BaseHTTPRequestHandler], None]
Query = dict[str, list[str]]


def target(raw: str) -> tuple[str, Query]:
    split = urlsplit(raw)
    return split.path, parse_qs(split.query, keep_blank_values=True)


def parameter(query: Query, *, name: str, default: str) -> str:
    values = query.get(name, ())
    return values[-1] if values else default


def redirect(request: BaseHTTPRequestHandler, *, location: str) -> None:
    request.send_response(HTTPStatus.TEMPORARY_REDIRECT)
    request.send_header("Location", location)
    request.end_headers()


def html(request: BaseHTTPRequestHandler, *, body: str, head: bool) -> None:
    encoded = body.encode()

    request.send_response(HTTPStatus.OK)
    request.send_header("Content-Type", "text/html; charset=utf-8")
    request.send_header("Content-Length", str(len(encoded)))
    request.end_headers()

    if not head:
        request.wfile.write(encoded)


with nullcontext():

    def _integer(value: str) -> int | None:
        return int(value) if value.isascii() and value.isdecimal() else None

    def _range(header: str | None, *, size: int) -> tuple[int, int] | None:
        if header is None:
            return 0, size - 1

        match header.split("=", 1):
            case ["bytes", raw] if "," not in raw:
                match raw.split("-", 1):
                    case [start_raw, end_raw]:
                        match _integer(start_raw), _integer(end_raw):
                            case None, int(suffix) if not start_raw:
                                start, end = max(0, size - suffix), size - 1
                            case int(start), None if not end_raw:
                                end = size - 1
                            case int(start), int(end):
                                ...
                            case _:
                                return 0, size - 1
                    case _:
                        return 0, size - 1
                return (start, end) if 0 <= start <= end < size else None
            case _:
                return 0, size - 1

    def _chunks(*, source: BufferedReader, size: int) -> Iterator[bytes]:
        while size and (chunk := source.read1(size)):
            size -= len(chunk)
            yield chunk

    def file(
        request: BaseHTTPRequestHandler,
        *,
        path: Path,
        content_type: str,
        head: bool,
    ) -> None:
        size = path.stat().st_size
        if (selected := _range(request.headers.get("Range"), size=size)) is None:
            request.send_response(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
            request.send_header("Content-Range", f"bytes */{size}")
            request.send_header("Content-Length", "0")
            request.end_headers()
            return
        start, end = selected
        status = (
            HTTPStatus.PARTIAL_CONTENT if start or end != size - 1 else HTTPStatus.OK
        )

        request.send_response(status)
        request.send_header("Accept-Ranges", "bytes")
        request.send_header("Content-Length", str(end - start + 1))
        request.send_header("Content-Type", content_type)
        if status is HTTPStatus.PARTIAL_CONTENT:
            request.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        request.end_headers()

        if head:
            return

        with path.open("rb") as source:
            source.seek(start)
            for chunk in _chunks(source=source, size=end - start + 1):
                request.wfile.write(chunk)


with nullcontext():

    def _terminate(process: Popen[bytes]) -> None:
        with suppress(ProcessLookupError):
            killpg(process.pid, SIGTERM)

        with suppress(TimeoutError):
            process.wait(timeout=2)

        if process.poll() is None:
            with suppress(ProcessLookupError):
                killpg(process.pid, SIGKILL)

    @contextmanager
    def _output(
        *, command: tuple[str | PathLike[str], ...]
    ) -> Iterator[BufferedReader]:
        with Popen(
            command, stdin=DEVNULL, stdout=PIPE, stderr=DEVNULL, start_new_session=True
        ) as process:
            try:
                yield cast(BufferedReader, process.stdout)
                process.wait(timeout=5)
            finally:
                if process.poll() is None:
                    _terminate(process)

    def stream(
        request: BaseHTTPRequestHandler,
        *,
        command: tuple[str | PathLike[str], ...],
        content_type: str,
        head: bool,
    ) -> None:
        request.close_connection = True

        request.send_response(HTTPStatus.OK)
        request.send_header("Content-Type", content_type)
        request.send_header("Cache-Control", "no-store")
        request.send_header("Connection", "close")
        request.end_headers()

        if head:
            return

        with suppress(BrokenPipeError, ConnectionResetError, TimeoutError):
            with _output(command=command) as output:
                for chunk in iter(output.read1, b""):
                    request.wfile.write(chunk)


def _handler(handlers: Mapping[str, _HandlerFn]) -> type[BaseHTTPRequestHandler]:
    def dispatch(request: BaseHTTPRequestHandler) -> None:
        if (handler := handlers.get(request.command)) is None:
            request.send_error(HTTPStatus.METHOD_NOT_ALLOWED)
            return
        handler(request)

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        do_HEAD = dispatch
        do_GET = dispatch
        do_POST = dispatch

        def log_message(self, format: str, *args: Any) -> None:
            getLogger().info(format, *args)

    return Handler


class _Server(ThreadingMixIn, UnixStreamServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, *, socket: Path, handler: type[BaseHTTPRequestHandler]) -> None:
        super().__init__(str(socket), handler)

    def server_close(self) -> None:
        try:
            super().server_close()
        finally:
            with suppress(FileNotFoundError):
                unlink(cast(str, self.server_address))


def unix_server(*, socket: Path, handlers: Mapping[str, _HandlerFn]) -> _Server:
    socket.parent.mkdir(parents=True, exist_ok=True)
    with suppress(FileNotFoundError):
        unlink(socket)
    return _Server(socket=socket, handler=_handler(handlers))
