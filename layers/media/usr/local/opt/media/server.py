from __future__ import annotations

from functools import partial
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler
from math import isfinite
from pathlib import Path, PurePosixPath
from posixpath import curdir, sep

from .ffmpeg import Probe, ProbeError, probe
from .filesystem import EntriesError, entries, resolve
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
    try:
        time = float(parameter(query, name="t", default="0"))
    except (OverflowError, ValueError):
        return "0"
    return f"{max(0, time):.3f}" if isfinite(time) else "0"


def _media(request: BaseHTTPRequestHandler, *, path: Path) -> Probe | None:
    try:
        return probe(path=path)
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
    path: Path,
    query: Query,
    head: bool,
) -> None:
    if (media := _media(request, path=path)) is None:
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


def _play(
    request: BaseHTTPRequestHandler,
    *,
    path: Path,
    query: Query,
    head: bool,
) -> None:
    selected = _profile(query)
    if (media := _media(request, path=path)) is None:
        return

    if (not media.videos and not media.audios) or selected is None:
        request.send_error(HTTPStatus.BAD_REQUEST)
        return
    profile, height = selected
    if (audio := _audio(media, query)) is None:
        request.send_error(HTTPStatus.BAD_REQUEST)
        return

    direct_content_type = media.direct_content_type(audio=audio)
    if profile == _NATIVE_PROFILE and direct_content_type:
        file(request, path=path, content_type=direct_content_type, head=head)
        return
    stream(
        request,
        command=tuple(media.command(audio=audio, height=height, time=_time(query))),
        content_type="video/mp4" if media.videos else "audio/mp4",
        head=head,
    )


def _subtitle(
    request: BaseHTTPRequestHandler,
    *,
    path: Path,
    query: Query,
    head: bool,
) -> None:
    stream_index = parameter(query, name="stream", default="")
    if (media := _media(request, path=path)) is None:
        return
    subtitle = next(
        (item for item in media.subtitles if item.index == stream_index), None
    )
    if subtitle is None:
        request.send_error(HTTPStatus.BAD_REQUEST)
        return
    stream(
        request,
        command=media.subtitle_command(subtitle=subtitle, time=_time(query)),
        content_type="text/vtt; charset=utf-8",
        head=head,
    )


def _dispatch(root: Path, request: BaseHTTPRequestHandler, *, head: bool) -> None:
    raw, query = target(request.path)
    if (resolved := resolve(root=root, raw=raw)) is None:
        request.send_error(HTTPStatus.NOT_FOUND)
        return
    relative, path = resolved

    if path.is_dir():
        if not raw.endswith(sep):
            redirect(request, location=f"{curdir}{sep}")
            return
        _index(request, path=path, head=head)
        return
    if path.is_file():
        _player(request, relative=relative, path=path, query=query, head=head)
        return

    if not path.parent.is_file():
        request.send_error(HTTPStatus.NOT_FOUND)
        return

    match relative.name:
        case "play":
            _play(request, path=path.parent, query=query, head=head)
        case "subtitle":
            _subtitle(request, path=path.parent, query=query, head=head)
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
