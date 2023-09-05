from argparse import ArgumentParser, Namespace
from asyncio import (
    StreamReader,
    StreamWriter,
    open_unix_connection,
    run,
    start_unix_server,
)
from base64 import b64decode, b64encode
from collections.abc import (
    Awaitable,
    Callable,
    Iterator,
    Mapping,
    MutableMapping,
    MutableSequence,
    Sequence,
    Set,
)
from contextlib import suppress
from fnmatch import translate
from functools import cache
from hashlib import pbkdf2_hmac,scrypt
from hmac import compare_digest
from http.cookies import CookieError, Morsel, SimpleCookie
from os.path import normcase
from pathlib import Path, PurePosixPath
from re import compile
from secrets import token_bytes
from typing import NewType, Pattern
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


@cache
def _translate(pattern: str) -> Pattern[str]:
    re = translate(pattern)
    return compile(re)


def _fnmatch(host: str, pattern: str) -> bool:
    re = _translate(pattern)
    return re.match(host) is not None


def _read_cookies(headers: _Headers, key: str) -> Morsel | None:
    for cs in headers.get(b"cookie", []):
        with suppress(CookieError):
            cookies = SimpleCookie(str(cs))
            if morsel := cookies.get(key, None):
                return morsel


def _write_cookies(writer: StreamWriter, key: str, secret: bytes, host: bytes) -> None:
    salt = token_bytes()
    value = b64encode(salt + host) + b"." + b64encode(secret)
    cookie = SimpleCookie()
    cookie[key] = str(value)
    writer.write(str(cookie).encode() + b"\r\n")


def _auth_headers(headers: _Headers) -> Iterator[bytes]:
    for auth in headers.get(b"authorization", []):
        lhs, sep, rhs = auth.partition(b" ")
        if sep and lhs.lower() in {b"basic", b"bearer"}:
            yield rhs


def _host(headers: _Headers) -> bytes:
    return b"".join(headers.get(b"host", ()))


async def _subrequest(sock: Path, auth: bytes) -> bool:
    with suppress(FileNotFoundError, ConnectionRefusedError):
        reader, writer = await open_unix_connection(normcase(sock))
        writer.write(b"GET / HTTP/1.1\r\nAuthorization: Basic " + auth + b"\r\n\r\n")
        await writer.drain()
        line = await anext(reader)
        _, status, _ = line.strip().split()
        return int(status) in range(200, 299)

    return False


async def _login(
    writer: StreamWriter,
    sock: Path,
    session_key: str,
    headers: _Headers,
    query: _Queries,
) -> None:
    host = _host(headers)
    user = "".join(query.get("username", ""))
    passwd = "".join(query.get("password", ""))
    auth = b64encode(f"{user}:{passwd}".encode())
    authorized = await _subrequest(sock, auth=auth)
    if authorized:
        writer.write(b"HTTP/1.1 204 No Content\r\n")
        _write_cookies(writer, key=session_key, value=auth.decode())
        writer.write(b"\r\n")
    else:
        writer.write(b"HTTP/1.1 401 Unauthorized\r\n\r\n")


def _auth(
    writer: StreamWriter,
    session_key: str,
    headers: _Headers,
    allow_list: Set[str],
) -> None:
    host = _host(headers)
    domain = host.decode()
    if any(_fnmatch(domain, pattern) for pattern in allow_list):
        writer.write(b"HTTP/1.1 204 No Content\r\n\r\n")
        return

    if cookie := _read_cookies(headers, key=session_key):
        text = b64decode(cookie.value)
        salt, _, sig = text.partition(b".")
        _ = salt + host
        code = b""
        if compare_digest(sig, code):
            writer.write(b"HTTP/1.1 204 No Content\r\n\r\n")
            return

    writer.write(b"HTTP/1.1 401 Unauthorized\r\n\r\n")


def _handler(
    sock: Path, session_key: str, allow_list: Set[str]
) -> Callable[[StreamReader, StreamWriter], Awaitable[None]]:
    async def cont(reader: StreamReader, writer: StreamWriter) -> None:
        try:
            _, path, query, headers = await _parse(reader)
            for auth in _auth_headers(headers):
                if await _subrequest(sock=sock, auth=auth):
                    writer.write(b"HTTP/1.1 204 No Content\r\n")
                    _write_cookies(writer, key=session_key, value=auth.decode())
                    writer.write(b"\r\n")
                    break
            else:
                if path.relative_to("/login"):
                    await _login(
                        writer,
                        sock=sock,
                        session_key=session_key,
                        headers=headers,
                        query=query,
                    )
                else:
                    _auth(
                        writer,
                        session_key=session_key,
                        headers=headers,
                        allow_list=allow_list,
                    )
        except Exception:
            writer.write(b"HTTP/1.1 400 Bad Request\r\n\r\n")
            raise
        finally:
            await writer.wait_closed()

    return cont


def _parse_args() -> Namespace:
    parser = ArgumentParser()
    parser.add_argument("--listening-socket", type=Path, required=True)
    parser.add_argument("--htpasswd-socket", type=Path, required=True)
    parser.add_argument("--session-key", required=True)
    parser.add_argument("--allow-list", type=Path, required=True)
    return parser.parse_args()


async def main() -> None:
    args = _parse_args()
    allow_list = {
        line for line in Path(args.allow_list).read_text().splitlines() if line
    }
    handler = _handler(
        args.htpasswd_socket, session_key=args.session_key, allow_list=allow_list
    )
    server = await start_unix_server(handler, normcase(args.socket))

    async with server:
        await server.serve_forever()


run(main())
