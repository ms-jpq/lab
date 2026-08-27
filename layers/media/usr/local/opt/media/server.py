from __future__ import annotations

from contextlib import suppress
from functools import partial
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler
from math import isfinite
from pathlib import Path, PurePosixPath
from posixpath import curdir, sep
from stat import S_ISDIR, S_ISREG

from .ffmpeg import Probe, ProbeError, Stream, probe
from .filesystem import EntriesError, Entry, entries, entry, resolve
from .html import index as index_html
from .html import player as player_html
from .http import (
    Query,
    _Server,
    file,
    html,
    redirect,
    stream,
    target,
    unix_server,
)
from .lang import select_subtitle

_NATIVE_PROFILE = "native"
_HEIGHTS = {
    _NATIVE_PROFILE: None,
    "2160p": 2160,
    "1080p": 1080,
    "720p": 720,
}


def _profiles(media: Probe) -> tuple[str, ...]:
    match media.videos:
        case (Stream(height=int(height)), *_):
            return tuple(
                profile
                for profile, maximum in _HEIGHTS.items()
                if maximum is None or maximum <= height
            )
        case _:
            return (_NATIVE_PROFILE,)


def _profile(profiles: tuple[str, ...], query: Query) -> tuple[str, int | None] | None:
    match query:
        case {"profile": [*_, profile]}:
            return (profile, _HEIGHTS[profile]) if profile in profiles else None
        case _:
            return _NATIVE_PROFILE, None


def _selected(streams: tuple[Stream, ...], *, value: str) -> Stream | None:
    for item in streams:
        if str(item.index) == value:
            return item
    return None


def _audio(media: Probe, query: Query) -> Stream | None:
    match query:
        case {"audio": [*_, value]}:
            return _selected(media.audios, value=value)
        case _:
            return media.default_audio


def _subtitle(
    media: Probe,
    *,
    audio: Stream | None,
    request: BaseHTTPRequestHandler,
    query: Query,
) -> Stream | None:
    match query:
        case {"subtitle": [*_, value]}:
            return _selected(media.subtitles, value=value)
        case {"subtitle": _}:
            return None
        case _:
            return select_subtitle(
                audio=audio,
                subtitles=media.subtitles,
                accept_language=request.headers.get("Accept-Language"),
            )


def _time(query: Query) -> str:
    match query:
        case {"t": [*_, value]}:
            with suppress(OverflowError, ValueError):
                time = float(value)
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

    profiles = _profiles(media)
    if (selected := _profile(profiles, query)) is None:
        request.send_error(HTTPStatus.BAD_REQUEST)
        return

    profile, _ = selected
    audio = _audio(media, query)
    audio_index = audio.index if audio else None
    subtitle = _subtitle(media, audio=audio, request=request, query=query)

    transformed = (
        profile != _NATIVE_PROFILE
        or media.direct_content_type(audio=audio_index) is None
    )
    html(
        request,
        body=player_html(
            audio=audio_index,
            probe=media,
            relative=relative,
            profile=profile,
            profiles=profiles,
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
    if (media := _media(request, entry=entry)) is None:
        return

    if not media.videos and not media.audios:
        request.send_error(HTTPStatus.BAD_REQUEST)
        return

    if (selected := _profile(_profiles(media), query)) is None:
        request.send_error(HTTPStatus.BAD_REQUEST)
        return
    profile, height = selected

    audio = _audio(media, query)
    audio_index = audio.index if audio else None

    match profile, media.direct_content_type(audio=audio_index):
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
                source=media.stream(
                    audio=audio_index,
                    height=height,
                    time=_time(query),
                ),
                content_type="video/mp4" if media.videos else "audio/mp4",
                head=head,
            )


def _subtitle_stream(
    request: BaseHTTPRequestHandler,
    *,
    entry: Entry,
    query: Query,
    head: bool,
) -> None:
    if (media := _media(request, entry=entry)) is None:
        return
    match query:
        case {"stream": [*_, value]} if (
            subtitle := _selected(media.subtitles, value=value)
        ) is not None:
            stream(
                request,
                source=media.subtitle(subtitle=subtitle, time=_time(query)),
                content_type="text/vtt; charset=utf-8",
                head=head,
            )
        case _:
            request.send_error(HTTPStatus.BAD_REQUEST)


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
                    _subtitle_stream(
                        request, entry=(source, data), query=query, head=head
                    )
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
