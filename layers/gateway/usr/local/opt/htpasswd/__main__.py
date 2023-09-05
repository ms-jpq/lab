from argparse import ArgumentParser, Namespace
from asyncio import (
    StreamReader,
    StreamWriter,
    open_unix_connection,
    run,
    start_unix_server,
)
from base64 import b64decode, b64encode
from collections.abc import Iterator, Mapping, MutableMapping, MutableSequence, Sequence
from contextlib import suppress
from hmac import compare_digest
from http.cookies import CookieError, Morsel, SimpleCookie
from os.path import normcase
from pathlib import Path, PurePosixPath
from typing import NewType
from urllib.parse import parse_qs, urlsplit

_Headers = NewType("_Headers", Mapping[bytes, Sequence[bytes]])
_Queries = NewType("_Queries", Mapping[str, Sequence[str]])


async def _parse(
    reader: StreamReader,
) -> tuple[bytes, PurePosixPath, _Queries, _Headers]:
    line = await anext(reader)
    method, path, _ = line.strip().split()
    parsed = urlsplit(str(path))
    p = PurePosixPath(parsed.path)
    q = parse_qs(parsed.query)

    headers: MutableMapping[bytes, MutableSequence[bytes]] = {}
    async for line in reader:
        if header := line.strip():
            key, sep, val = header.partition(b":")
            if sep:
                headers.setdefault(key.strip().lower(), []).append(val.strip())
        else:
            break

    return method, p, _Queries(q), _Headers(headers)


def _read_cookies(headers: _Headers, key: str) -> Morsel | None:
    for cs in headers.get(b"cookie", []):
        with suppress(CookieError):
            cookies = SimpleCookie(str(cs))
            if morsel := cookies.get(key, None):
                return morsel


def _write_cookies(writer: StreamWriter, key: str, value: str) -> None:
    cookie = SimpleCookie()
    cookie[key] = value
    writer.write(b"Set-Cookie: " + cookie.output(header="").encode() + b"\r\n")


def _auth_headers(headers: _Headers) -> Iterator[bytes]:
    for auth in headers.get(b"authorization", []):
        lhs, sep, rhs = auth.partition(b" ")
        if sep and lhs.lower() in {b"basic", b"bearer"}:
            yield rhs


async def _subrequest(sock: Path, auth: bytes) -> bool:
    with suppress(FileNotFoundError, ConnectionRefusedError):
        reader, writer = await open_unix_connection(normcase(sock))
        writer.write(b"GET / HTTP/1.1\r\nAuthorization: Basic " + auth + b"\r\n\r\n")
        await writer.drain()
        line = await anext(reader)
        _, status, _ = line.strip().split()
        return int(status) in range(200, 299)

    return False


async def _login(writer: StreamWriter, sock: Path, query: _Queries) -> None:
    user = "".join(query.get("username", ""))
    passwd = "".join(query.get("password", ""))
    auth = b64encode(f"{user}:{passwd}".encode())
    authorized = await _subrequest(sock, auth=auth)
    if authorized:
        writer.write(b"HTTP/1.1 204 No Content\r\n")
        _write_cookies(writer, key="session", value=auth.decode())
        writer.write(b"\r\n")
    else:
        writer.write(b"HTTP/1.1 401 Unauthorized\r\n\r\n")


async def _auth(writer: StreamWriter, headers: _Headers) -> None:
    if cookie := _read_cookies(headers, key="session"):
        text = b64decode(cookie.value)
        lhs, _, rhs = text.partition(b".")
        if compare_digest(lhs, b"session"):
            writer.write(b"HTTP/1.1 204 No Content\r\n\r\n")
            return

    for auth in _auth_headers(headers):
        if await _subrequest(sock=Path(), auth=auth):
            writer.write(b"HTTP/1.1 204 No Content\r\n")
            _write_cookies(writer, key="session", value=auth.decode())
            writer.write(b"\r\n")
            return

    writer.write(b"HTTP/1.1 401 Unauthorized\r\n\r\n")


async def _handler(reader: StreamReader, writer: StreamWriter) -> None:
    try:
        _, path, query, headers = await _parse(reader)
        if path.relative_to("/auth"):
            await _auth(writer, headers=headers)
        elif path.relative_to("/login"):
            await _login(writer, sock=Path(), query=query)
    except Exception:
        writer.write(b"HTTP/1.1 400 Bad Request\r\n\r\n")
        raise
    finally:
        await writer.wait_closed()


def _parse_args() -> Namespace:
    parser = ArgumentParser()
    parser.add_argument("listening-socket")
    parser.add_argument("htpasswd-socket")
    parser.add_argument("session-key")
    return parser.parse_args()


async def main() -> None:
    args = _parse_args()
    server = await start_unix_server(_handler, normcase(args.socket))

    async with server:
        await server.serve_forever()


run(main())
