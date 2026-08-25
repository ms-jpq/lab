from __future__ import annotations

from contextlib import suppress
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler
from io import BufferedReader
from logging import getLogger
from os import PathLike, unlink
from pathlib import Path, PurePosixPath
from socketserver import ThreadingMixIn, UnixStreamServer
from subprocess import DEVNULL, PIPE, Popen
from typing import Any, Iterator, cast
from urllib.parse import parse_qs, unquote, urlsplit

from . import ffmpeg, html, process

_NATIVE_PROFILE = "native"
_PROFILES = {
    _NATIVE_PROFILE: (None, None),
    "720p": (720, 4_000_000),
    "1080p": (1080, 8_000_000),
    "2160p": (2160, 16_000_000),
}


class _Media:
    def __init__(self, *, root: Path) -> None:
        self.root = root.resolve(strict=True)

    def resolve(self, raw: str) -> tuple[PurePosixPath, Path]:
        decoded = unquote(raw)
        path = PurePosixPath(decoded)
        if not path.is_absolute() or any(part in {".", ".."} for part in path.parts):
            raise ValueError(raw)
        relative = PurePosixPath(*path.parts[1:])
        target = self.root.joinpath(*relative.parts).resolve(strict=False)
        if not target.is_relative_to(self.root):
            raise ValueError(raw)
        return relative, target


class _Server(ThreadingMixIn, UnixStreamServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, *, address: str, media: _Media) -> None:
        self.media = media
        super().__init__(address, _Handler)


class _Handler(BaseHTTPRequestHandler):
    server: _Server
    protocol_version = "HTTP/1.1"

    def do_GET(self) -> None:
        self._dispatch(head=False)

    def do_HEAD(self) -> None:
        self._dispatch(head=True)

    def _dispatch(self, *, head: bool) -> None:
        split = urlsplit(self.path)
        try:
            relative, target = self.server.media.resolve(split.path)
        except ValueError:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        query = parse_qs(split.query, keep_blank_values=True)
        if target.is_dir():
            if not split.path.endswith("/"):
                self.send_response(HTTPStatus.TEMPORARY_REDIRECT)
                self.send_header("Location", "./")
                self.end_headers()
                return
            self._index(path=target, query=query, head=head)
            return
        if target.is_file():
            self._player(relative=relative, path=target, query=query, head=head)
            return
        if (
            relative.name in {"play", "subtitle"}
            and (parent := target.parent).is_file()
        ):
            if relative.name == "play":
                self._play(path=parent, query=query, head=head)
            else:
                self._subtitle(path=parent, query=query, head=head)
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def _index(self, *, path: Path, query: dict[str, list[str]], head: bool) -> None:
        name = _one(query, name="q", default="")
        needle = name.casefold()
        entries = tuple(
            sorted(
                (
                    (entry, detail)
                    for entry in path.iterdir()
                    if (detail := _entry_kind(path=entry)) is not None
                    and (not needle or needle in entry.name.casefold())
                ),
                key=lambda item: (
                    item[1] is html.EntryKind.FILE,
                    item[0].name.casefold(),
                    item[0].name,
                ),
            )
        )
        body = html.index(
            entries=entries,
            query=name,
        )
        self._html(body=body, head=head)

    def _player(
        self,
        *,
        relative: PurePosixPath,
        path: Path,
        query: dict[str, list[str]],
        head: bool,
    ) -> None:
        probe = ffmpeg.probe(path=path)
        videos = probe.videos
        audios = probe.audios
        if not videos and not audios:
            self.send_error(HTTPStatus.UNSUPPORTED_MEDIA_TYPE)
            return
        profile = _one(query, name="profile", default=_NATIVE_PROFILE)
        if profile not in _PROFILES:
            self.send_error(HTTPStatus.BAD_REQUEST)
            return
        default_audio = probe.default_audio
        audio = _one(
            query,
            name="audio",
            default=default_audio.index if default_audio else "",
        )
        if audio and not any(stream.index == audio for stream in audios):
            self.send_error(HTTPStatus.BAD_REQUEST)
            return
        text_subtitles = probe.subtitles
        subtitle = _one(query, name="subtitle", default="")
        if subtitle and not any(stream.index == subtitle for stream in text_subtitles):
            self.send_error(HTTPStatus.BAD_REQUEST)
            return
        body = html.player(
            audio=audio,
            probe=probe,
            relative=relative,
            profile=profile,
            profiles=tuple(_PROFILES),
            subtitle=subtitle,
            time=_time(query),
            title=path.name,
        )
        self._html(body=body, head=head)

    def _play(self, *, path: Path, query: dict[str, list[str]], head: bool) -> None:
        probe = ffmpeg.probe(path=path)
        videos = probe.videos
        audios = probe.audios
        profile = _one(query, name="profile", default=_NATIVE_PROFILE)
        if (not videos and not audios) or profile not in _PROFILES:
            self.send_error(HTTPStatus.BAD_REQUEST)
            return
        default_audio = probe.default_audio
        audio = _one(
            query,
            name="audio",
            default=default_audio.index if default_audio else "",
        )
        if audio and not any(stream.index == audio for stream in audios):
            self.send_error(HTTPStatus.BAD_REQUEST)
            return
        time = _time(query)
        if profile == _NATIVE_PROFILE and probe.direct(audio=audio):
            self._file(
                path=path,
                content_type="video/mp4" if videos else "audio/mp4",
                head=head,
            )
            return
        height, bitrate = _PROFILES[profile]
        self._stream(
            command=tuple(
                probe.command(
                    audio=audio,
                    height=height,
                    bitrate=bitrate,
                    time=time,
                )
            ),
            content_type="video/mp4" if videos else "audio/mp4",
            head=head,
        )

    def _subtitle(self, *, path: Path, query: dict[str, list[str]], head: bool) -> None:
        stream = _one(query, name="stream", default="")
        probe = ffmpeg.probe(path=path)
        subtitle = next(
            (item for item in probe.subtitles if item.index == stream),
            None,
        )
        if subtitle is None:
            self.send_error(HTTPStatus.BAD_REQUEST)
            return
        self._stream(
            command=probe.subtitle_command(subtitle=subtitle),
            content_type="text/vtt; charset=utf-8",
            head=head,
        )

    def _stream(
        self,
        *,
        command: tuple[str | PathLike[str], ...],
        content_type: str,
        head: bool,
    ) -> None:
        self.close_connection = True
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.end_headers()
        if head:
            return
        child = Popen(
            command,
            stdin=DEVNULL,
            stdout=PIPE,
            stderr=DEVNULL,
            start_new_session=True,
        )
        try:
            output = cast(BufferedReader, child.stdout)
            for chunk in iter(lambda: output.read1(1 << 20), b""):
                self.wfile.write(chunk)
            child.wait(timeout=5)
        except (BrokenPipeError, ConnectionResetError, TimeoutError):
            process.terminate(child)
        finally:
            if child.poll() is None:
                process.terminate(child)

    def _file(self, *, path: Path, content_type: str, head: bool) -> None:
        size = path.stat().st_size
        start, end = _range(self.headers.get("Range"), size=size)
        status = (
            HTTPStatus.PARTIAL_CONTENT if start or end != size - 1 else HTTPStatus.OK
        )
        self.send_response(status)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(end - start + 1))
        if status == HTTPStatus.PARTIAL_CONTENT:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Type", content_type)
        self.end_headers()
        if head:
            return
        with path.open("rb") as file:
            file.seek(start)
            for chunk in _chunks(file=file, size=end - start + 1):
                self.wfile.write(chunk)

    def _html(self, *, body: str, head: bool) -> None:
        encoded = body.encode()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        if not head:
            self.wfile.write(encoded)

    def log_message(self, format: str, *args: Any) -> None:
        getLogger().info(format, *args)


def serve(*, root: Path, socket: Path) -> None:
    socket.parent.mkdir(parents=True, exist_ok=True)
    with suppress(FileNotFoundError):
        unlink(socket)
    server = _Server(address=str(socket), media=_Media(root=root))
    try:
        with suppress(KeyboardInterrupt):
            server.serve_forever()
    finally:
        server.server_close()
        with suppress(FileNotFoundError):
            unlink(socket)


def _chunks(*, file: Any, size: int) -> Iterator[bytes]:
    remaining = size
    while remaining:
        chunk = file.read(min(1 << 20, remaining))
        if not chunk:
            return
        remaining -= len(chunk)
        yield chunk


def _entry_kind(*, path: Path) -> html.EntryKind | None:
    if path.is_dir():
        return html.EntryKind.DIRECTORY
    if path.is_file():
        return html.EntryKind.FILE
    return None


def _one(query: dict[str, list[str]], *, name: str, default: str) -> str:
    values = query.get(name, ())
    return values[-1] if values else default


def _range(header: str | None, *, size: int) -> tuple[int, int]:
    if not header:
        return 0, size - 1
    try:
        unit, raw = header.split("=", 1)
        start_raw, end_raw = raw.split("-", 1)
        if unit != "bytes" or "," in raw:
            raise ValueError(header)
        if start_raw:
            start = int(start_raw)
            end = int(end_raw) if end_raw else size - 1
        else:
            suffix = int(end_raw)
            start, end = max(0, size - suffix), size - 1
        if not 0 <= start <= end < size:
            raise ValueError(header)
    except ValueError:
        return 0, size - 1
    return start, end


def _time(query: dict[str, list[str]]) -> str:
    try:
        return str(max(0, int(float(_one(query, name="t", default="0")))))
    except ValueError:
        return "0"
