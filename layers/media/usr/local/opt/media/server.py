from __future__ import annotations

from contextlib import suppress
from functools import partial
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler
from math import isfinite
from pathlib import Path, PurePosixPath
from posixpath import curdir, sep
from stat import S_ISDIR, S_ISREG

from .ffmpeg import Probe, ProbeError, probe
from .filesystem import EntriesError, Entry, entries, entry, resolve
from .html import index as index_html
from .html import player as player_html
from .http import (
    Query,
    _Server,
    file,
    html,
    parameter,
    redirect,
    stream,
    target,
    unix_server,
)

_NATIVE_PROFILE = "native"
_HEIGHTS = {
    _NATIVE_PROFILE: None,
    "2160p": 2160,
    "1080p": 1080,
    "720p": 720,
}


def _profile(query: Query) -> tuple[str, int | None] | None:
    profile = parameter(query, name="profile", default=_NATIVE_PROFILE)
    if profile not in _HEIGHTS:
        return None
    return profile, _HEIGHTS[profile]


def _audio(media: Probe, query: Query) -> str | None:
    audio = parameter(
        query,
        name="audio",
        default=media.default_audio.index if media.default_audio else "",
    )
    return (
        audio
        if any(item.index == audio for item in media.audios)
        or not audio
        and media.videos
        else None
    )


def _time(query: Query) -> str:
    with suppress(OverflowError, ValueError):
        time = float(parameter(query, name="t", default="0"))
        if isfinite(time):
            return f"{max(0, time):.3f}"
    return "0"


def _media(request: BaseHTTPRequestHandler, *, entry: Entry) -> Probe | None:
    path, data = entry
    try:
        return probe(path=path, modified=data.st_mtime_ns)
    except ProbeError:
        request.send_error(HTTPStatus.UNSUPPORTED_MEDIA_TYPE)
        return None


def _index(
    request: BaseHTTPRequestHandler,
    *,
    path: Path,
    head: bool,
) -> None:
    try:
        selected = entries(path=path)
    except EntriesError:
        request.send_error(HTTPStatus.FORBIDDEN)
        return

    html(
        request,
        body=index_html(entries=selected),
        head=head,
    )


def _player(
    request: BaseHTTPRequestHandler,
    *,
    relative: PurePosixPath,
    entry: Entry,
    query: Query,
    head: bool,
) -> None:
    path, _ = entry
    if (media := _media(request, entry=entry)) is None:
        return

    if not media.videos and not media.audios:
        request.send_error(HTTPStatus.UNSUPPORTED_MEDIA_TYPE)
        return

    if (selected := _profile(query)) is None:
        request.send_error(HTTPStatus.BAD_REQUEST)
        return

    profile, _ = selected
    audio = _audio(media, query)
    subtitle = parameter(query, name="subtitle", default="")
    if audio is None or (
        subtitle and not any(stream.index == subtitle for stream in media.subtitles)
    ):
        request.send_error(HTTPStatus.BAD_REQUEST)
        return

    transformed = (
        profile != _NATIVE_PROFILE or media.direct_content_type(audio=audio) is None
    )
    html(
        request,
        body=player_html(
            audio=audio,
            probe=media,
            relative=relative,
            profile=profile,
            profiles=tuple(_HEIGHTS),
            subtitle=subtitle,
            time=_time(query),
            title=path.name,
            transformed=transformed,
        ),
        head=head,
    )


def _stream(
    request: BaseHTTPRequestHandler,
    *,
    entry: Entry,
    query: Query,
    head: bool,
) -> None:
    if (selected := _profile(query)) is None:
        request.send_error(HTTPStatus.BAD_REQUEST)
        return

    profile, height = selected
    if (media := _media(request, entry=entry)) is None:
        return

    if not media.videos and not media.audios:
        request.send_error(HTTPStatus.BAD_REQUEST)
        return

    if (audio := _audio(media, query)) is None:
        request.send_error(HTTPStatus.BAD_REQUEST)
        return

    match profile, media.direct_content_type(audio=audio):
        case _NATIVE_PROFILE, str(content_type):
            path, data = entry
            file(
                request,
                path=path,
                size=data.st_size,
                content_type=content_type,
                head=head,
            )
        case _:
            stream(
                request,
                source=media.stream(audio=audio, height=height, time=_time(query)),
                content_type="video/mp4" if media.videos else "audio/mp4",
                head=head,
            )


def _subtitle(
    request: BaseHTTPRequestHandler,
    *,
    entry: Entry,
    query: Query,
    head: bool,
) -> None:
    stream_index = parameter(query, name="stream", default="")
    if (media := _media(request, entry=entry)) is None:
        return
    subtitle = next(
        (item for item in media.subtitles if item.index == stream_index), None
    )
    if subtitle is None:
        request.send_error(HTTPStatus.BAD_REQUEST)
        return
    stream(
        request,
        source=media.subtitle(subtitle=subtitle, time=_time(query)),
        content_type="text/vtt; charset=utf-8",
        head=head,
    )


def _dispatch(root: Path, request: BaseHTTPRequestHandler, *, head: bool) -> None:
    raw, query = target(request.path)
    if (resolved := resolve(root=root, raw=raw)) is None:
        request.send_error(HTTPStatus.NOT_FOUND)
        return
    relative, path = resolved

    match entry(path=path):
        case source, data if S_ISDIR(data.st_mode):
            if not raw.endswith(sep):
                redirect(request, location=f"{curdir}{sep}")
                return
            _index(request, path=source, head=head)
            return
        case source, data if S_ISREG(data.st_mode):
            _player(
                request,
                relative=relative,
                entry=(source, data),
                query=query,
                head=head,
            )
            return
        case _:
            pass

    match entry(path=path.parent):
        case source, data if S_ISREG(data.st_mode):
            match relative.name:
                case "stream":
                    _stream(request, entry=(source, data), query=query, head=head)
                case "subtitle":
                    _subtitle(request, entry=(source, data), query=query, head=head)
                case _:
                    request.send_error(HTTPStatus.NOT_FOUND)
        case _:
            request.send_error(HTTPStatus.NOT_FOUND)


def server(*, root: Path, socket: Path) -> _Server:
    root = root.resolve(strict=True)
    return unix_server(
        socket=socket,
        handlers={
            "HEAD": partial(_dispatch, root, head=True),
            "GET": partial(_dispatch, root, head=False),
        },
    )
