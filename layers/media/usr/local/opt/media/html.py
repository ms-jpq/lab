from __future__ import annotations

from collections.abc import Iterable, Iterator
from functools import cache
from html import escape
from importlib.resources import files
from itertools import chain
from pathlib import PurePath, PurePosixPath
from posixpath import curdir, sep
from re import compile
from string import Template
from urllib.parse import quote, urlencode

from .ffmpeg import Probe, Stream
from .filesystem import EntryKind

_PLACEHOLDER = compile(r"<!--\s*(\$\{[_A-Za-z][_A-Za-z0-9]*\})\s*-->")


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


def _entry(*, path: PurePath, detail: EntryKind) -> str:
    name = path.name + (sep if detail is EntryKind.DIRECTORY else "")
    return _render(
        "index-entry.html",
        href=escape(quote(name), quote=True),
        name=escape(name),
    )


def _metadata_rows(*, probe: Probe) -> Iterator[tuple[str, str]]:
    if probe.duration:
        yield "Duration", probe.duration
    yield "Container", probe.container

    for stream in probe.videos + probe.audios + probe.subtitles:
        yield (
            f"Stream {stream.index}",
            " ".join(
                str(value)
                for value in (
                    stream.kind,
                    stream.codec,
                    stream.width,
                    stream.height,
                )
                if value
            ),
        )


def _metadata(*, probe: Probe) -> str:
    return "".join(
        _render(
            "metadata-entry.html",
            key=escape(key),
            value=escape(value),
        )
        for key, value in _metadata_rows(probe=probe)
    )


def _player_element(*, has_video: bool, play_url: str, track: str) -> str:
    return _render(
        "player-video.html" if has_video else "player-audio.html",
        play_url=escape(play_url, quote=True),
        track=track,
    )


def _subtitle_track(*, url: str) -> str:
    return _render("subtitle-track.html", url=escape(url, quote=True))


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
    entries: tuple[tuple[PurePath, EntryKind], ...],
    query: str,
) -> str:
    return _render(
        "index.html",
        entries="".join(_entry(path=path, detail=detail) for path, detail in entries),
        query=escape(query),
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
) -> str:
    play_query = {"profile": profile, "t": time}
    if audio:
        play_query["audio"] = audio
    track = ""
    if subtitle:
        track = _subtitle_track(
            url=_child(
                relative=relative,
                endpoint="subtitle",
                query={"stream": subtitle},
            )
        )
    return _render(
        "player.html",
        audio_options=_stream_options(
            probe.audios,
            selected=audio,
            empty="No audio",
        ),
        metadata=_metadata(probe=probe),
        player=_player_element(
            has_video=bool(probe.videos),
            play_url=_child(
                relative=relative,
                endpoint="play",
                query=play_query,
            ),
            track=track,
        ),
        profile_options=_options(
            ((value, value) for value in profiles), selected=profile
        ),
        subtitle_options=_stream_options(
            probe.subtitles,
            selected=subtitle,
            empty="None",
        ),
        summary=escape(f"{title} — {probe.duration}s" if probe.duration else title),
        script=_resource("player.js"),
        time=escape(time, quote=True),
        title=escape(title),
    )
