#!/usr/bin/env -S -- PYTHONSAFEPATH= python3

from argparse import ArgumentParser, Namespace
from asyncio import (
    StreamReader,
    StreamReaderProtocol,
    StreamWriter,
    TimeoutError,
    gather,
    get_running_loop,
    open_unix_connection,
    run,
    wait_for,
)
from base64 import urlsafe_b64decode, urlsafe_b64encode
from collections.abc import (
    AsyncIterator,
    Callable,
    Iterator,
    Mapping,
    MutableMapping,
    MutableSequence,
    Sequence,
)
from concurrent.futures import ProcessPoolExecutor
from contextlib import asynccontextmanager, closing, nullcontext, suppress
from dataclasses import dataclass
from fnmatch import translate
from functools import lru_cache
from hmac import compare_digest, digest
from html import escape
from http.cookies import CookieError, Morsel, SimpleCookie
from io import BytesIO
from ipaddress import IPv4Address, IPv6Address, IPv6Interface, IPv6Network, ip_interface
from itertools import repeat
from logging import DEBUG, StreamHandler, captureWarnings, getLogger
from multiprocessing import cpu_count
from pathlib import Path, PurePosixPath
from posixpath import commonpath, normpath, sep
from re import compile
from socket import SOMAXCONN, AddressFamily, SocketKind, fromfd, socket
from stat import S_IRGRP, S_IROTH, S_IRUSR, S_IWGRP, S_IWOTH, S_IWUSR
from time import time
from typing import NewType
from urllib.parse import SplitResultBytes, parse_qs, urlsplit

_Method = NewType("_Method", bytes)
_Headers = NewType("_Headers", Mapping[bytes, Sequence[bytes]])
_Query = NewType("_Query", Mapping[bytes, Sequence[bytes]])
_Req = tuple[_Method, bytes, SplitResultBytes, _Query, _Headers]


_IP = IPv6Address | IPv4Address


@dataclass(frozen=True)
class _Th:
    allow_list: frozenset[str]
    authn_path: bytes
    cookie_name: str
    cookie_ttl: float
    domain_parts: int
    fd: int
    hmac_secret: bytes
    max_ipv6_prefix: int
    remote_sock: Path
    timeout: float


_ALGORITHM = "sha512"
_RW_RW_RW_ = (S_IRUSR | S_IWUSR) | (S_IRGRP | S_IWGRP) | (S_IROTH | S_IWOTH)


def _fnmatch(patterns: frozenset[str]) -> Callable[[str], bool]:
    re = {compile(translate(pat)) for pat in patterns}

    @lru_cache
    def cont(host_path: str) -> bool:
        return any(r.match(host_path) for r in re)

    return cont


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


def _ip(headers: _Headers, max_ipv6_prefix: int) -> _IP:
    for ip in headers.get(b"x-real-ip", []):
        if ip == b"unix:":
            return IPv6Address(0)
        elif isinstance(iface := ip_interface(ip.decode()), IPv6Interface):
            prefix = min(iface.network.prefixlen, max_ipv6_prefix)
            net = IPv6Network((iface.network.network_address, prefix), strict=False)
            return next(net.hosts())
        else:
            return iface.ip
    else:
        assert False


def _path(headers: _Headers) -> str:
    for path in headers.get(b"x-forwarded-uri", ()):
        with suppress(UnicodeError):
            return path.decode()
    else:
        return sep


def _auth_headers(headers: _Headers) -> Iterator[tuple[bytes, bytes]]:
    for auth in headers.get(b"authorization", []):
        lhs, sep, rhs = auth.partition(b" ")
        if sep and lhs.lower() in {b"basic", b"bearer"}:
            with suppress(ValueError):
                user, _, _ = urlsafe_b64decode(rhs).partition(b":")
                yield user, rhs


def _encode(secret: bytes, plain: bytes) -> bytes:
    sig = digest(key=secret, msg=plain, digest=_ALGORITHM)
    crip = urlsafe_b64encode(plain) + b"." + urlsafe_b64encode(sig)
    return crip


def _decode(secret: bytes, crip: bytes) -> bytes:
    bplain, bsig = crip.split(b".")
    plain, sig = urlsafe_b64decode(bplain), urlsafe_b64decode(bsig)
    expected = digest(key=secret, msg=plain, digest=_ALGORITHM)
    if not compare_digest(sig, expected):
        raise ValueError()
    else:
        return plain


def _read_auth_cookies(headers: _Headers, name: str, secret: bytes) -> bool:
    for cs in headers.get(b"cookie", []):
        with suppress(CookieError):
            cookies = SimpleCookie(cs.decode())
            if morsel := cookies.get(name, None):
                crip = morsel.value.encode()
                with suppress(ValueError):
                    plain = _decode(secret, crip=crip).decode()
                    _, _, exp = plain.partition(":")
                    d = int(exp) - time()
                    if d >= 0:
                        return True
    else:
        return False


def _write_auth_cookies(
    domain_parts: int,
    name: str,
    ttl: float,
    secret: bytes,
    host: str,
    secure: bool,
    user: bytes,
) -> Morsel[str]:
    domain = ".".join(host.split(".")[-domain_parts:])
    now = time()
    plain = user + b":" + str(int(now + ttl)).encode()
    crip = _encode(secret, plain=plain)
    cookie = SimpleCookie()
    cookie[name] = crip.decode()
    morsel = cookie[name]
    morsel["domain"] = domain
    morsel["expires"] = int(now + ttl)
    morsel["httponly"] = True
    morsel["max-age"] = int(ttl)
    morsel["path"] = "/"
    morsel["samesite"] = "Strict"
    morsel["secure"] = secure
    return morsel


@asynccontextmanager
async def finalize(writer: StreamWriter) -> AsyncIterator[None]:
    with suppress(BrokenPipeError):
        try:
            with closing(writer):
                try:
                    yield
                finally:
                    await writer.drain()
        finally:
            await writer.wait_closed()


async def _subrequest(sock: Path, credentials: bytes, ip: _IP) -> bool:
    addr = ip.exploded.encode()
    reader, writer = await open_unix_connection(sock)
    async with finalize(writer):
        writer.write(b"GET / HTTP/1.0\r\nAuthorization: Basic ")
        writer.write(credentials)
        writer.write(b"\r\n")
        writer.write(b"X-Real-IP: ")
        writer.write(addr)
        writer.write(b"\r\n\r\n")
        _, line = await gather(writer.drain(), anext(reader))
        _, status, *_ = line.strip().split()
        return int(status) in range(200, 299)


async def _thread(th: _Th) -> None:
    sock = fromfd(th.fd, family=AddressFamily.AF_UNIX, type=SocketKind.SOCK_STREAM)
    loop = get_running_loop()
    match = _fnmatch(th.allow_list)

    async def cont(reader: StreamReader, writer: StreamWriter) -> None:
        async with finalize(writer):
            req = await _parse(reader)
            _, path, parsed, query, headers = req
            assert parsed.hostname
            host = parsed.hostname.decode()

            proto = b"".join(headers.get(b"x-forwarded-proto", ()))
            secure = proto != b"http"
            cname = "__Secure-" + th.cookie_name if secure else th.cookie_name

            user = None
            if commonpath((th.authn_path, path)) == th.authn_path:
                location = b"".join(query.get(b"redirect", ()))
                user = b"".join(query.get(b"username", ()))
                passwd = b"".join(query.get(b"password", ()))
                auth = urlsafe_b64encode(user + b":" + passwd)
                ip = _ip(headers, max_ipv6_prefix=th.max_ipv6_prefix)
                authorized = await _subrequest(
                    sock=th.remote_sock, credentials=auth, ip=ip
                )
            else:
                location = None
                path_info = host + _path(headers)
                authorized = match(path_info)
                if not authorized:
                    authorized = _read_auth_cookies(
                        headers, name=cname, secret=th.hmac_secret
                    )
                if not authorized:
                    ip = _ip(headers, max_ipv6_prefix=th.max_ipv6_prefix)
                    for user, auth in _auth_headers(headers):
                        authorized = await _subrequest(
                            sock=th.remote_sock, credentials=auth, ip=ip
                        )
                        if authorized:
                            break

            w = BytesIO()
            if not authorized:
                if location:
                    w.write(b"HTTP/1.0 307 Temporary Redirect\r\n")
                else:
                    w.write(b"HTTP/1.0 401 Unauthorized\r\n")
                    for accept in headers.get(b"accept", ()):
                        if b"html" in accept:
                            break
                    else:
                        w.write(b'WWW-Authenticate: Basic realm="-"\r\n')
            else:
                if location:
                    w.write(b"HTTP/1.0 307 Temporary Redirect\r\n")
                else:
                    w.write(b"HTTP/1.0 204 No Content\r\n")

                if user:
                    cookie = _write_auth_cookies(
                        domain_parts=th.domain_parts,
                        name=cname,
                        ttl=th.cookie_ttl,
                        secret=th.hmac_secret,
                        host=host,
                        secure=secure,
                        user=user,
                    )
                    w.write(str(cookie).encode())
                    w.write(b"\r\n")

            if location:
                for header in (b"Location: ", b"X-Original-URL: "):
                    w.write(header)
                    w.write(location)
                    w.write(b"\r\n")

            if user:
                with suppress(UnicodeError):
                    esc = escape(user.decode()).encode()
                    w.write(b"X-Auth-User: ")
                    w.write(esc)
                    w.write(b"\r\n")

            w.write(b"\r\n")
            buf = w.getbuffer()
            writer.write(buf)

    async def handler(reader: StreamReader, writer: StreamWriter) -> None:
        with suppress(TimeoutError):
            await wait_for(cont(reader, writer), timeout=th.timeout)

    def factory() -> StreamReaderProtocol:
        reader = StreamReader(loop=loop)
        protocol = StreamReaderProtocol(reader, client_connected_cb=handler, loop=loop)
        return protocol

    server = await loop.create_unix_server(factory, backlog=SOMAXCONN, sock=sock)
    async with server:
        await server.serve_forever()


def _srv(th: _Th) -> None:
    run(_thread(th))


def _parse_args() -> Namespace:
    parser = ArgumentParser()
    parser.add_argument("--listening-socket", type=Path, required=True)
    parser.add_argument("--htpasswd-socket", type=Path, required=True)
    parser.add_argument("--domain_parts", type=int, default=2)
    parser.add_argument("--cookie-name", default="htpasswd")
    parser.add_argument("--cookie-ttl", type=float, required=True)
    parser.add_argument("--allow-list", type=Path, nargs="*")
    parser.add_argument("--hmac-secret", required=True)
    parser.add_argument("--authn-path", type=PurePosixPath, required=True)
    parser.add_argument("--nprocs", type=int, default=cpu_count())
    parser.add_argument("--timeout", type=float, default=1.0)
    parser.add_argument("--max-ipv6-prefix", type=int, default=56)
    return parser.parse_args()


def main() -> None:
    args = _parse_args()

    hmac_secret = str(args.hmac_secret).encode()
    allow_list = frozenset(
        line
        for allow in args.allow_list
        for path in Path(allow).glob("*.txt")
        for line in path.read_text().splitlines()
        if line
    )
    remote_sock = Path(args.htpasswd_socket)
    authn_path = PurePosixPath(args.authn_path).as_posix()
    assert authn_path.startswith(sep)

    listening_socket = Path(args.listening_socket)
    listening_socket.unlink(missing_ok=True)

    sock = socket(family=AddressFamily.AF_UNIX)
    sock.bind(listening_socket.as_posix())
    listening_socket.chmod(_RW_RW_RW_)
    fd = sock.fileno()

    th = _Th(
        allow_list=allow_list,
        authn_path=authn_path.encode(),
        cookie_name=args.cookie_name,
        cookie_ttl=args.cookie_ttl,
        domain_parts=args.domain_parts,
        fd=fd,
        hmac_secret=hmac_secret,
        max_ipv6_prefix=args.max_ipv6_prefix,
        remote_sock=remote_sock,
        timeout=args.timeout,
    )

    with ProcessPoolExecutor() as pool:
        for _ in pool.map(_srv, repeat(th, times=args.nprocs)):
            pass


with nullcontext():
    LOG = getLogger()
    LOG.addHandler(StreamHandler())
    LOG.setLevel(DEBUG)
    captureWarnings(True)
    main()
