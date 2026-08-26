from __future__ import annotations

from collections.abc import Iterable
from functools import cache
from html import escape
from importlib.resources import files
from itertools import chain
from pathlib import PurePath, PurePosixPath
from posixpath import curdir, sep
from re import compile
from stat import S_ISDIR, S_ISREG
from string import Template
from urllib.parse import quote, urlencode

from .ffmpeg import Probe, Stream
from .filesystem import Entry

_PLACEHOLDER = compile(
    r"(?:<!--\s*|/\*\s*)(\$\{[_A-Za-z][_A-Za-z0-9]*\})(?:\s*-->|\s*\*/)"
)


@cache
def _resource(name: str) -> str:
    resource = files(__package__) / "templates" / name
    return resource.read_text()


@cache
def _template(name: str) -> Template:
    return Template(_PLACEHOLDER.sub(r"\1", _resource(name)))


def _render(template_name: str, **values: str) -> str:
    return _template(template_name).substitute(values)


def _child(*, relative: PurePosixPath, endpoint: str, query: dict[str, str]) -> str:
    return f"{curdir}{sep}{quote(relative.name)}{sep}{endpoint}?{urlencode(query)}"


def _size(size: int | None) -> str:
    if size is None:
        return "—"
    if size < 1 << 10:
        return f"{size} B"
    if size < 1 << 20:
        return f"{size / (1 << 10):.1f} KiB"
    if size < 1 << 30:
        return f"{size / (1 << 20):.1f} MiB"
    if size < 1 << 40:
        return f"{size / (1 << 30):.1f} GiB"
    return f"{size / (1 << 40):.1f} TiB"


def _entry(*, entry: Entry) -> str:
    path, data = entry
    name = path.name + (sep if S_ISDIR(data.st_mode) else "")
    return _render(
        "index-entry.html",
        href=escape(quote(name), quote=True),
        name=escape(name),
        size=_size(data.st_size if S_ISREG(data.st_mode) else None),
    )


def _mse_type(*, has_audio: bool, has_video: bool) -> str:
    match has_video, has_audio:
        case True, True:
            return 'video/mp4; codecs="avc1.640033,mp4a.40.2"'
        case True, False:
            return 'video/mp4; codecs="avc1.640033"'
        case False, _:
            return 'audio/mp4; codecs="mp4a.40.2"'
        case _:
            assert False


def _player_element(
    *,
    duration: str,
    has_audio: bool,
    has_video: bool,
    stream_url: str,
    track: str,
    transformed: bool,
) -> str:
    return _render(
        "player-video.html" if has_video else "player-audio.html",
        duration=escape(duration, quote=True),
        mse_type=_mse_type(has_audio=has_audio, has_video=has_video),
        stream_url=escape(stream_url, quote=True),
        track=track,
        transformed=str(transformed).lower(),
    )


def _subtitle_track(*, language: str, url: str) -> str:
    return _render(
        "subtitle-track.html",
        language=escape(language, quote=True),
        url=escape(url, quote=True),
    )


def _option(*, value: str, label: str, selected: bool) -> str:
    return _render(
        "option-selected.html" if selected else "option.html",
        label=escape(label),
        value=escape(value, quote=True),
    )


def _options(options: Iterable[tuple[str, str]], *, selected: str) -> str:
    return "".join(
        _option(value=value, label=label, selected=value == selected)
        for value, label in options
    )


def _stream_options(streams: tuple[Stream, ...], *, selected: str, empty: str) -> str:
    return _options(
        chain(
            (("", empty),),
            (
                (stream.index, f"{stream.index}: {stream.language} {stream.codec}")
                for stream in streams
            ),
        ),
        selected=selected,
    )


def index(
    *,
    entries: tuple[Entry, ...],
) -> str:
    return _render(
        "index.html",
        entries="".join(_entry(entry=entry) for entry in entries),
        style=_resource("style.css"),
    )


def player(
    *,
    audio: str,
    probe: Probe,
    relative: PurePosixPath,
    profile: str,
    profiles: tuple[str, ...],
    subtitle: str,
    time: str,
    title: str,
    transformed: bool,
) -> str:
    play_query = {"profile": profile, "t": time}
    if audio:
        play_query["audio"] = audio
    track = ""
    if subtitle:
        selected_subtitle = next(
            stream for stream in probe.subtitles if stream.index == subtitle
        )
        subtitle_query = {"stream": subtitle}
        if transformed:
            subtitle_query["t"] = time
        track = _subtitle_track(
            language=selected_subtitle.language,
            url=_child(
                relative=relative,
                endpoint="subtitle",
                query=subtitle_query,
            ),
        )
    return _render(
        "player.html",
        audio_options=_stream_options(
            probe.audios,
            selected=audio,
            empty="No audio",
        ),
        player=_player_element(
            duration=probe.duration or "0",
            has_audio=bool(audio),
            has_video=bool(probe.videos),
            stream_url=_child(
                relative=relative,
                endpoint="stream",
                query=play_query,
            ),
            track=track,
            transformed=transformed,
        ),
        profile_options=_options(
            ((value, value) for value in profiles), selected=profile
        ),
        subtitle_options=_stream_options(
            probe.subtitles,
            selected=subtitle,
            empty="None",
        ),
        script=_resource("player.js"),
        style=_resource("style.css"),
        time=escape(time, quote=True),
        title=escape(title),
    )
