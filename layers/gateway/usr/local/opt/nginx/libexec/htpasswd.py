from argparse import ArgumentParser, Namespace
from asyncio import (
    StreamReader,
    StreamWriter,
    gather,
    open_unix_connection,
    run,
    start_unix_server,
)
from base64 import b64encode, urlsafe_b64decode, urlsafe_b64encode
from collections.abc import (
    Awaitable,
    Callable,
    Iterator,
    Mapping,
    MutableMapping,
    MutableSequence,
    Sequence,
)
from contextlib import suppress
from fnmatch import translate
from functools import cache, lru_cache
from hmac import compare_digest, digest
from http.cookies import CookieError, SimpleCookie
from os.path import normcase
from pathlib import Path, PurePosixPath
from re import compile
from time import time
from typing import NewType, Pattern
from urllib.parse import parse_qs, urlsplit

_Method = NewType("_Method", bytes)
_Headers = NewType("_Headers", Mapping[bytes, Sequence[bytes]])
_Queries = NewType("_Queries", Mapping[bytes, Sequence[bytes]])
_Request = tuple[_Method, PurePosixPath, _Queries, _Headers]

_ALGORITHM = "sha512"
_OK = b"HTTP/1.1 204 No Content\r\n\r\n"
_DIE = b"HTTP/1.1 401 Unauthorized\r\n\r\n"


async def _parse(reader: StreamReader) -> _Request:
    line = await anext(reader)
    method, path, _ = line.strip().split()
    parsed = urlsplit(path)
    p = PurePosixPath(parsed.path.decode())
    q = parse_qs(parsed.query)

    headers: MutableMapping[bytes, MutableSequence[bytes]] = {}
    async for line in reader:
        if header := line.strip():
            key, sep, val = header.partition(b":")
            if sep:
                headers.setdefault(key.strip().lower(), []).append(val.strip())
        else:
            break

    return _Method(method), p, _Queries(q), _Headers(headers)


def _auth_headers(headers: _Headers) -> Iterator[bytes]:
    for auth in headers.get(b"authorization", []):
        lhs, sep, rhs = auth.partition(b" ")
        if sep and lhs.lower() in {b"basic", b"bearer"}:
            yield rhs


@cache
def _translate(pattern: str) -> Pattern[str]:
    re = translate(pattern)
    return compile(re)


@lru_cache
def _fnmatch(host: str, patterns: frozenset[str]) -> bool:
    return any(_translate(pattern).match(host) for pattern in patterns)


def _decode(secret: bytes, crip: bytes) -> bytes:
    bplain, bsig = crip.split(b".")
    plain, sig = urlsafe_b64decode(bplain), urlsafe_b64decode(bsig)
    expected = digest(key=secret, msg=plain, digest=_ALGORITHM)
    if not compare_digest(sig, expected):
        raise ValueError()
    else:
        return plain


def _encode(secret: bytes, plain: bytes) -> bytes:
    sig = digest(key=secret, msg=plain, digest=_ALGORITHM)
    crip = urlsafe_b64encode(plain) + b"." + urlsafe_b64encode(sig)
    return crip


def _read_auth_cookies(headers: _Headers, key: str, secret: bytes) -> bool:
    for cs in headers.get(b"cookie", []):
        with suppress(CookieError):
            cookies = SimpleCookie(cs.decode())
            if morsel := cookies.get(key, None):
                crip = morsel.value.encode()
                exp = _decode(secret, crip=crip).decode()
                if time() < int(exp):
                    return True

    return False


def _write_auth_cookies(writer: StreamWriter, key: str, secret: bytes) -> None:
    now = str(int(time())).encode()
    crip = _encode(secret, plain=now)
    cookie = SimpleCookie()
    cookie[key] = crip.decode()
    writer.write(b"HTTP/1.1 204 No Content\r\n")
    writer.write(str(cookie).encode())
    writer.write(b"\r\n\r\n")


async def _subrequest(sock: Path, credentials: bytes) -> bool:
    reader, writer = await open_unix_connection(sock)
    writer.write(b"GET / HTTP/1.1\r\nAuthorization: Basic ")
    writer.write(credentials)
    writer.write(b"\r\n\r\n")
    _, line = await gather(writer.drain(), anext(reader))
    _, status, _ = line.strip().split()
    return int(status) in range(200, 299)


async def _login(
    writer: StreamWriter,
    sock: Path,
    session_key: str,
    secret: bytes,
    query: _Queries,
) -> None:
    user = b"".join(query.get(b"username", ()))
    passwd = b"".join(query.get(b"password", ()))
    auth = b64encode(user + b":" + passwd)
    authorized = await _subrequest(sock, credentials=auth)

    if authorized:
        _write_auth_cookies(writer, key=session_key, secret=secret)
    else:
        writer.write(_DIE)


def _auth(
    writer: StreamWriter,
    session_key: str,
    secret: bytes,
    headers: _Headers,
    allow_list: frozenset[str],
) -> None:
    host = b"".join(headers.get(b"host", ())).decode()
    with suppress(ValueError):
        if _fnmatch(host, allow_list):
            writer.write(_OK)
            return

        if _read_auth_cookies(headers, key=session_key, secret=secret):
            writer.write(_OK)
            return

    writer.write(_DIE)


def _handler(
    sock: Path, session_key: str, secret: bytes, allow_list: frozenset[str]
) -> Callable[[StreamReader, StreamWriter], Awaitable[None]]:
    async def cont(reader: StreamReader, writer: StreamWriter) -> None:
        try:
            _, path, query, headers = await _parse(reader)

            for auth in _auth_headers(headers):
                if await _subrequest(sock=sock, credentials=auth):
                    _write_auth_cookies(writer, key=session_key, secret=secret)
                    break
            else:
                if path.relative_to("/login"):
                    await _login(
                        writer,
                        sock=sock,
                        session_key=session_key,
                        secret=secret,
                        query=query,
                    )
                else:
                    _auth(
                        writer,
                        session_key=session_key,
                        secret=secret,
                        headers=headers,
                        allow_list=allow_list,
                    )
        finally:
            await writer.wait_closed()

    return cont


def _parse_args() -> Namespace:
    parser = ArgumentParser()
    parser.add_argument("--listening-socket", type=Path, required=True)
    parser.add_argument("--htpasswd-socket", type=Path, required=True)
    parser.add_argument("--session-key", required=True)
    parser.add_argument("--allow-list", type=Path, required=True)
    parser.add_argument("--secret", type=Path, required=True)
    return parser.parse_args()


async def main() -> None:
    args = _parse_args()
    secret = Path(args.secret).read_bytes()
    allow_list = frozenset(
        line for line in Path(args.allow_list).read_text().splitlines() if line
    )
    handler = _handler(
        args.htpasswd_socket,
        session_key=args.session_key,
        secret=secret,
        allow_list=allow_list,
    )
    server = await start_unix_server(handler, normcase(args.socket))

    async with server:
        await server.serve_forever()


run(main())
