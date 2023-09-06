#!/usr/bin/env -S -- PYTHONSAFEPATH= python3

from argparse import ArgumentParser, Namespace
from asyncio import (
    StreamReader,
    StreamWriter,
    gather,
    open_unix_connection,
    run,
    start_unix_server,
)
from base64 import urlsafe_b64decode, urlsafe_b64encode
from collections.abc import (
    AsyncIterator,
    Awaitable,
    Callable,
    Iterator,
    Mapping,
    MutableMapping,
    MutableSequence,
    Sequence,
)
from contextlib import asynccontextmanager, closing, nullcontext, suppress
from fnmatch import translate
from functools import lru_cache
from hmac import compare_digest, digest
from http.cookies import CookieError, SimpleCookie
from logging import DEBUG, StreamHandler, captureWarnings, getLogger
from pathlib import Path, PurePosixPath
from posixpath import commonpath, normpath
from re import compile
from time import time
from typing import NewType
from urllib.parse import SplitResultBytes, parse_qs, urlsplit

_Method = NewType("_Method", bytes)
_Headers = NewType("_Headers", Mapping[bytes, Sequence[bytes]])
_Query = NewType("_Query", Mapping[bytes, Sequence[bytes]])
_Req = tuple[_Method, bytes, SplitResultBytes, _Query, _Headers]

_ALGORITHM = "sha512"

with nullcontext():
    LOG = getLogger()
    LOG.addHandler(StreamHandler())
    LOG.setLevel(DEBUG)
    captureWarnings(True)


def _fnmatch(patterns: frozenset[str]) -> Callable[[str], bool]:
    re = {compile(translate(pat)) for pat in patterns}

    @lru_cache
    def cont(host: str) -> bool:
        return any(r.match(host) for r in re)

    return cont


@asynccontextmanager
async def finalize(writer: StreamWriter) -> AsyncIterator[None]:
    try:
        with closing(writer):
            try:
                yield
            finally:
                await writer.drain()
    finally:
        await writer.wait_closed()


async def _parse(reader: StreamReader) -> _Req:
    line = await anext(reader)
    method, path, _ = line.strip().split()

    headers: MutableMapping[bytes, MutableSequence[bytes]] = {}
    async for line in reader:
        if header := line.strip():
            key, sep, val = header.partition(b":")
            if sep:
                headers.setdefault(key.strip().lower(), []).append(val.strip())
        else:
            break

    host = b"".join(headers.get(b"host", ()))
    parsed = urlsplit(b"ssh://" + host + path)
    ps = normpath(parsed.path)
    query = parse_qs(parsed.query)
    return _Method(method.upper()), ps, parsed, _Query(query), _Headers(headers)


def _auth_headers(authn_path: bytes, req: _Req) -> Iterator[tuple[bytes, bytes | None]]:
    _, path, _, query, headers = req
    for auth in headers.get(b"authorization", []):
        lhs, sep, rhs = auth.partition(b" ")
        if sep and lhs.lower() in {b"basic", b"bearer"}:
            yield rhs, None
    else:
        LOG.debug("%s", (authn_path, path))
        if commonpath((authn_path, path)) == authn_path:
            user = b"".join(query.get(b"username", ()))
            passwd = b"".join(query.get(b"password", ()))
            redirect = b"".join(query.get(b"redirect", ()))
            auth = urlsafe_b64encode(user + b":" + passwd)
            yield auth, redirect


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
    writer: StreamWriter, name: str, ttl: float, secret: bytes, host: str, secure: bool
) -> None:
    now = time()
    plain = str(int(now + ttl)).encode()
    crip = _encode(secret, plain=plain)
    cookie = SimpleCookie[str]()
    cookie[name] = crip.decode()
    morsel = cookie[name]
    morsel["domain"] = host
    morsel["expires"] = int(now + ttl)
    morsel["httponly"] = True
    morsel["max-age"] = int(ttl)
    morsel["path"] = "/"
    morsel["samesite"] = "Strict"
    morsel["secure"] = secure
    writer.write(str(cookie).encode())
    writer.write(b"\r\n")


async def _subrequest(sock: Path, credentials: bytes) -> bool:
    reader, writer = await open_unix_connection(sock)
    async with finalize(writer):
        writer.write(b"GET / HTTP/1.0\r\nAuthorization: Basic ")
        writer.write(credentials)
        writer.write(b"\r\n\r\n")
        _, line = await gather(writer.drain(), anext(reader))
        LOG.debug("%s", line)
        _, status, *_ = line.strip().split()
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
        async with finalize(writer):
            req = await _parse(reader)
            _, _, parsed, _, headers = req
            LOG.debug("%s", req)

            assert parsed.hostname
            host = parsed.hostname.decode()
            if match(host) or _read_auth_cookies(
                headers, name=cookie_name, secret=hmac_secret
            ):
                LOG.debug("%s", "allowed")
                writer.write(b"HTTP/1.0 204 No Content\r\n\r\n")
                return

            for auth, redirect in _auth_headers(authn_path, req=req):
                if await _subrequest(sock=sock, credentials=auth):
                    proto = b"".join(headers.get(b"x-forwarded-proto", ()))
                    secure = proto != b"http"
                    if redirect:
                        writer.write(b"HTTP/1.0 307 Temporary Redirect\r\n")
                    else:
                        writer.write(b"HTTP/1.0 204 No Content\r\n")
                    _write_auth_cookies(
                        writer,
                        name=cookie_name,
                        ttl=cookie_ttl,
                        secret=hmac_secret,
                        host=host,
                        secure=secure,
                    )
                    LOG.debug("%s", "cookied")
                    if redirect:
                        writer.write(b"Location: ")
                        writer.write(redirect)
                        writer.write(b"\r\n")
                        LOG.debug("%s", f"redirecting -> {redirect}")

                    writer.write(b"\r\n")
                    LOG.debug("%s", "allowed")
                    return
            else:
                LOG.debug("%s", "forbidden")
                writer.write(b"HTTP/1.0 401 Unauthorized\r\n\r\n")

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
    LOG.debug("%s", args)

    hmac_secret = Path(args.hmac_secret).read_bytes()
    allow_list = frozenset(
        line
        for allow in args.allow_list
        for line in Path(allow).read_text().splitlines()
        if line
    )
    listening_socket = Path(args.listening_socket)
    authn_path = PurePosixPath(args.authn_path).as_posix().encode()
    assert authn_path.startswith(b"/")

    handler = _handler(
        args.htpasswd_socket,
        cookie_name=args.cookie_name,
        authn_path=authn_path,
        cookie_ttl=args.cookie_ttl,
        hmac_secret=hmac_secret,
        allow_list=allow_list,
    )
    server = await start_unix_server(handler, listening_socket)
    listening_socket.chmod(0o666)

    async with server:
        await server.serve_forever()


run(main())
