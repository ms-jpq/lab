from __future__ import annotations

from collections.abc import Iterator
from contextlib import nullcontext, suppress
from enum import StrEnum
from functools import partial
from http import HTTPStatus
from http.cookies import Morsel
from http.server import BaseHTTPRequestHandler
from math import isfinite
from pathlib import Path, PurePosixPath
from posixpath import sep
from stat import S_ISDIR, S_ISREG
from urllib.parse import quote

from .ffmpeg import Probe, ProbeError, Stream, probe
from .filesystem import EntriesError, Entry, entries, entry, resolve
from .html import Selection
from .html import index as index_html
from .html import player as player_html
from .html import resource
from .http import (
    Query,
    _Server,
    content,
    cookies,
    html,
    redirect,
    set_cookie,
    stream,
    target,
    unix_server,
)
from .selection import select_stream

with nullcontext():
    _NATIVE_PROFILE = "native"
    _PROFILE_HEIGHTS = {
        _NATIVE_PROFILE: None,
        "2160p": 2160,
        "1440p": 1440,
        "1080p": 1080,
        "720p": 720,
    }

with nullcontext():
    _COOKIE_PATH = "/media/"


class _Preference(StrEnum):
    AUDIO = "audio"
    SUBTITLE = "subtitle"


def _available_profiles(media: Probe) -> tuple[str, ...]:
    match media.videos:
        case (Stream(height=int(height)), *_):
            return tuple(
                profile
                for profile, output_height in _PROFILE_HEIGHTS.items()
                if output_height is None or output_height <= height
            )
        case _:
            return (_NATIVE_PROFILE,)


def _select_profile(
    profiles: tuple[str, ...], query: Query
) -> tuple[str, int | None] | None:
    match query:
        case {"profile": [*_, profile]} if profile in profiles:
            return profile, _PROFILE_HEIGHTS[profile]
        case {"profile": [*_, _]}:
            return None
        case _:
            return _NATIVE_PROFILE, None


def _stream_by_index(streams: tuple[Stream, ...], *, index: str) -> Stream | None:
    for candidate in streams:
        if str(candidate.index) == index:
            return candidate
    return None


def _stream_by_language(streams: tuple[Stream, ...], *, language: str) -> Stream | None:
    for candidate in streams:
        if candidate.language == language:
            return candidate
    return None


def _select_audio_stream(
    media: Probe, *, query: Query, preferences: dict[str, str]
) -> Stream | None:
    match query, preferences:
        case ({_Preference.AUDIO: [*_, str(language)]}, _) | (
            _,
            {_Preference.AUDIO: str(language)},
        ):
            return (
                _stream_by_language(media.audios, language=language)
                or media.default_audio
            )
        case _, _:
            return media.default_audio


def _query_preferences(query: Query) -> dict[str, str]:
    return {
        name: values[-1] or Selection.NONE
        for name in _Preference
        if (values := query.get(name))
    }


def _preference_cookies(query: Query) -> Iterator[Morsel[str]]:
    for name, value in _query_preferences(query).items():
        yield set_cookie(
            name=name,
            path=_COOKIE_PATH,
            value=value,
        )


def _start_time(query: Query) -> str:
    match query:
        case {"t": [*_, value]}:
            with suppress(OverflowError, ValueError):
                seconds = float(value)
                if isfinite(seconds):
                    return f"{max(0, seconds):.3f}"
    return "0"


def _probe_media(request: BaseHTTPRequestHandler, *, entry: Entry) -> Probe | None:
    path, stat = entry
    try:
        return probe(path=path, modified=stat.st_mtime_ns)
    except ProbeError:
        request.send_error(
            HTTPStatus.UNSUPPORTED_MEDIA_TYPE,
            message=HTTPStatus.UNSUPPORTED_MEDIA_TYPE.phrase,
        )
        return None


def _select_subtitle_stream(
    media: Probe,
    *,
    audio: Stream | None,
    query: Query,
    preferences: dict[str, str],
    request: BaseHTTPRequestHandler,
) -> Stream | None:
    requested_language = _query_preferences(query).get(_Preference.SUBTITLE)
    for language in (requested_language, preferences.get(_Preference.SUBTITLE)):
        if language == Selection.NONE:
            return None
        if language and (
            subtitle := _stream_by_language(media.subtitles, language=language)
        ):
            return subtitle

    return select_stream(
        audio=audio,
        streams=media.subtitles,
        accept_language=request.headers.get("Accept-Language"),
    )


def _serve_directory(
    request: BaseHTTPRequestHandler,
    *,
    path: Path,
    relative: PurePosixPath,
    head: bool,
) -> None:
    try:
        directory_entries = entries(path=path)
    except EntriesError:
        request.send_error(HTTPStatus.FORBIDDEN, message=HTTPStatus.FORBIDDEN.phrase)
        return

    html(
        request,
        body=index_html(
            relative=relative,
            entries=directory_entries,
        ),
        head=head,
    )


def _serve_player(
    request: BaseHTTPRequestHandler,
    *,
    relative: PurePosixPath,
    entry: Entry,
    query: Query,
    head: bool,
) -> None:
    path, _ = entry
    if (media := _probe_media(request, entry=entry)) is None:
        return

    if not media.videos and not media.audios:
        request.send_error(
            HTTPStatus.UNSUPPORTED_MEDIA_TYPE,
            message=HTTPStatus.UNSUPPORTED_MEDIA_TYPE.phrase,
        )
        return

    profiles = _available_profiles(media)
    if (selected_profile := _select_profile(profiles, query)) is None:
        request.send_error(
            HTTPStatus.BAD_REQUEST, message=HTTPStatus.BAD_REQUEST.phrase
        )
        return

    profile, _ = selected_profile
    preferences = cookies(request)
    audio = _select_audio_stream(media, query=query, preferences=preferences)
    subtitle = _select_subtitle_stream(
        media,
        audio=audio,
        query=query,
        preferences=preferences,
        request=request,
    )

    html(
        request,
        cookies=_preference_cookies(query),
        body=player_html(
            audio=audio,
            probe=media,
            relative=relative,
            profile=profile,
            profiles=profiles,
            subtitle=subtitle,
            time=_start_time(query),
            title=path.name,
        ),
        head=head,
    )


def _serve_media_stream(
    request: BaseHTTPRequestHandler,
    *,
    entry: Entry,
    query: Query,
    head: bool,
) -> None:
    if (media := _probe_media(request, entry=entry)) is None:
        return

    if not media.videos and not media.audios:
        request.send_error(
            HTTPStatus.BAD_REQUEST, message=HTTPStatus.BAD_REQUEST.phrase
        )
        return

    if (selected_profile := _select_profile(_available_profiles(media), query)) is None:
        request.send_error(
            HTTPStatus.BAD_REQUEST, message=HTTPStatus.BAD_REQUEST.phrase
        )
        return

    _, height = selected_profile
    audio = _select_audio_stream(media, query=query, preferences=cookies(request))
    audio_index = audio.index if audio else None

    stream(
        request,
        source=media.stream(
            audio=audio_index,
            height=height,
            time=_start_time(query),
        ),
        content_type="video/mp4" if media.videos else "audio/mp4",
        head=head,
    )


def _serve_subtitle_stream(
    request: BaseHTTPRequestHandler,
    *,
    entry: Entry,
    query: Query,
    head: bool,
) -> None:
    if (media := _probe_media(request, entry=entry)) is None:
        return
    match query:
        case {"stream": [*_, index]} if (
            subtitle := _stream_by_index(media.subtitles, index=index)
        ) is not None:
            stream(
                request,
                source=media.subtitle(subtitle=subtitle, time=_start_time(query)),
                content_type="text/vtt; charset=utf-8",
                cookies=_preference_cookies(
                    {_Preference.SUBTITLE: [subtitle.language]}
                ),
                head=head,
            )
        case _:
            request.send_error(
                HTTPStatus.BAD_REQUEST, message=HTTPStatus.BAD_REQUEST.phrase
            )


def _serve_player_script(
    request: BaseHTTPRequestHandler,
    *,
    head: bool,
    name: str,
) -> None:
    try:
        body = resource("player", name).encode()
    except FileNotFoundError:
        request.send_error(HTTPStatus.NOT_FOUND, message=HTTPStatus.NOT_FOUND.phrase)
        return

    content(
        request,
        body=body,
        content_type="text/javascript; charset=utf-8",
        head=head,
    )


def _dispatch(root: Path, request: BaseHTTPRequestHandler, *, head: bool) -> None:
    raw, query = target(request.path)
    if (request_path := PurePosixPath(raw)).name.endswith(".js"):
        _serve_player_script(request, head=head, name=request_path.name)
        return

    if (resolved := resolve(root=root, raw=raw)) is None:
        request.send_error(HTTPStatus.NOT_FOUND, message=HTTPStatus.NOT_FOUND.phrase)
        return
    relative, path = resolved

    match entry(path=path):
        case source, stat if S_ISDIR(stat.st_mode):
            if not raw.endswith(sep):
                redirect(request, location=f"{quote(relative.name)}{sep}")
                return

            _serve_directory(
                request,
                path=source,
                relative=relative,
                head=head,
            )
            return

        case source, stat if S_ISREG(stat.st_mode):
            _serve_player(
                request,
                relative=relative,
                entry=(source, stat),
                query=query,
                head=head,
            )
            return

        case _:
            pass

    match entry(path=path.parent):
        case source, stat if S_ISREG(stat.st_mode):
            match relative.name:
                case "stream":
                    _serve_media_stream(
                        request, entry=(source, stat), query=query, head=head
                    )
                case "subtitle":
                    _serve_subtitle_stream(
                        request, entry=(source, stat), query=query, head=head
                    )
                case _:
                    request.send_error(
                        HTTPStatus.NOT_FOUND, message=HTTPStatus.NOT_FOUND.phrase
                    )
        case _:
            request.send_error(
                HTTPStatus.NOT_FOUND, message=HTTPStatus.NOT_FOUND.phrase
            )


def server(*, root: Path, socket: Path) -> _Server:
    root = root.resolve(strict=True)
    return unix_server(
        socket=socket,
        handlers={
            "HEAD": partial(_dispatch, root, head=True),
            "GET": partial(_dispatch, root, head=False),
        },
    )
