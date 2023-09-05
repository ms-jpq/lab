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
from functools import lru_cache
from hmac import compare_digest, digest
from http.cookies import CookieError, SimpleCookie
from os.path import normcase
from pathlib import Path, PurePosixPath
from posixpath import commonpath
from re import compile
from time import time
from typing import NewType
from urllib.parse import parse_qs, urlsplit

_Method = NewType("_Method", bytes)
_Headers = NewType("_Headers", Mapping[bytes, Sequence[bytes]])
_Query = NewType("_Query", Mapping[bytes, Sequence[bytes]])

_ALGORITHM = "sha512"


def _fnmatch(patterns: frozenset[str]) -> Callable[[str], bool]:
    re = {compile(translate(pat)) for pat in patterns}

    @lru_cache
    def cont(host: str) -> bool:
        return any(r.match(host) for r in re)

    return cont


async def _parse(
    reader: StreamReader,
) -> tuple[_Method, bytes, _Query, _Headers]:
    line = await anext(reader)
    method, path, _ = line.strip().split()
    parsed = urlsplit(path)
    query = parse_qs(parsed.query)

    headers: MutableMapping[bytes, MutableSequence[bytes]] = {}
    async for line in reader:
        if header := line.strip():
            key, sep, val = header.partition(b":")
            if sep:
                headers.setdefault(key.strip().lower(), []).append(val.strip())
        else:
            break

    return _Method(method), parsed.path, _Query(query), _Headers(headers)


def _auth_headers(headers: _Headers) -> Iterator[bytes]:
    for auth in headers.get(b"authorization", []):
        lhs, sep, rhs = auth.partition(b" ")
        if sep and lhs.lower() in {b"basic", b"bearer"}:
            yield rhs


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


def _read_auth_cookies(headers: _Headers, name: str, secret: bytes) -> bool:
    for cs in headers.get(b"cookie", []):
        with suppress(CookieError):
            cookies = SimpleCookie[str](cs.decode())
            if morsel := cookies.get(name, None):
                crip = morsel.value.encode()
                with suppress(ValueError):
                    exp = _decode(secret, crip=crip).decode()
                    if time() < int(exp):
                        return True
    else:
        return False


def _write_auth_cookies(
    writer: StreamWriter, name: str, ttl: float, secret: bytes
) -> None:
    now = str(int(time() + ttl)).encode()
    crip = _encode(secret, plain=now)
    cookie = SimpleCookie[str]()
    cookie[name] = crip.decode()
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


def _handler(
    sock: Path,
    authn_path: bytes,
    cookie_name: str,
    cookie_ttl: float,
    hmac_secret: bytes,
    allow_list: frozenset[str],
) -> Callable[[StreamReader, StreamWriter], Awaitable[None]]:
    match = _fnmatch(allow_list)

    async def cont(reader: StreamReader, writer: StreamWriter) -> None:
        try:
            _, path, query, headers = await _parse(reader)
            host = b"".join(headers.get(b"host", ())).decode()
            if match(host) or _read_auth_cookies(
                headers, name=cookie_name, secret=hmac_secret
            ):
                writer.write(b"HTTP/1.1 204 No Content\r\n\r\n")
                return

            for auth in _auth_headers(headers):
                if await _subrequest(sock=sock, credentials=auth):
                    _write_auth_cookies(
                        writer, name=cookie_name, ttl=cookie_ttl, secret=hmac_secret
                    )
                    return

            if commonpath((authn_path, path)) == authn_path:
                user = b"".join(query.get(b"username", ()))
                passwd = b"".join(query.get(b"password", ()))
                auth = b64encode(user + b":" + passwd)
                if await _subrequest(sock, credentials=auth):
                    _write_auth_cookies(
                        writer, name=cookie_name, ttl=cookie_ttl, secret=hmac_secret
                    )
                    return

            writer.write(b"HTTP/1.1 401 Unauthorized\r\n\r\n")
        finally:
            await writer.wait_closed()

    return cont


def _parse_args() -> Namespace:
    parser = ArgumentParser()
    parser.add_argument("--listening-socket", type=Path, required=True)
    parser.add_argument("--htpasswd-socket", type=Path, required=True)
    parser.add_argument("--cookie-name", required=True)
    parser.add_argument("--cookie-ttl", type=float, required=True)
    parser.add_argument("--allow-list", type=Path, nargs="*")
    parser.add_argument("--hmac-secret", type=Path, required=True)
    parser.add_argument("--authn-path", type=PurePosixPath, required=True)
    return parser.parse_args()


async def main() -> None:
    args = _parse_args()
    hmac_secret = Path(args.hmac_secret).read_bytes()
    allow_list = frozenset(
        line for line in Path(args.allow_list).read_text().splitlines() if line
    )
    authn_path = PurePosixPath(args.authn_path).as_posix().encode()
    assert authn_path.startswith(b"/")

    handler = _handler(
        args.htpasswd_socket,
        cookie_name=args.cookie_name,
        authn_path=authn_path,
        cookie_ttl=args.ttl,
        hmac_secret=hmac_secret,
        allow_list=allow_list,
    )
    server = await start_unix_server(handler, normcase(args.listening_socket))

    async with server:
        await server.serve_forever()


run(main())
