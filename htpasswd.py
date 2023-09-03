#!/usr/bin/env -S -- PYTHONSAFEPATH= python3


from asyncio import StreamReader, StreamWriter, run, start_unix_server, to_thread
from base64 import b64decode, b64encode
from contextlib import suppress
from hashlib import blake2b
from hmac import compare_digest
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from os import linesep
from os.path import normcase
from pathlib import PurePosixPath
from posixpath import sep
from sys import stdout
from typing import Any

NUL = "\0"

_POSIX_ROOT = PurePosixPath(sep)


async def main() -> None:
    async def handler(reader: StreamReader, _: StreamWriter) -> None:
        data = await reader.readuntil(b"\n")

        def cont() -> None:
            stdout.buffer.write(data)
            stdout.buffer.flush()

        await to_thread(cont)

    server = await start_unix_server(handler, normcase(""))

    async with server:
        await server.serve_forever()


run(main())
