from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from functools import lru_cache
from json import JSONDecodeError, loads
from os import PathLike
from pathlib import Path
from subprocess import CalledProcessError, TimeoutExpired, run
from typing import Any, Iterator

TEXT_SUBTITLES = frozenset(
    {"ass", "mov_text", "srt", "ssa", "subrip", "text", "webvtt"}
)
MP4_FORMATS = frozenset({"3g2", "3gp", "mj2", "mov", "mp4", "m4a"})

_COMMAND_PREFIX = ("ffmpeg", "-v", "error", "-nostdin")
_COMMAND_SUFFIX = (
    "-movflags",
    "frag_keyframe+empty_moov+default_base_moof",
    "-flush_packets",
    "1",
    "-f",
    "mp4",
    "pipe:1",
)


def _source_command(
    *, path: str | PathLike[str], time: str
) -> tuple[str | PathLike[str], ...]:
    return (
        *_COMMAND_PREFIX,
        "-i",
        path,
        *(("-ss", time) if time != "0" else ()),
    )


def _scale_filter(*, height: int) -> str:
    return f"scale=-2:min({height}\\,ih):force_original_aspect_ratio=decrease"


@dataclass(frozen=True, slots=True)
class Stream:
    index: str
    kind: str
    codec: str
    default: bool
    language: str
    width: int | None
    height: int | None


class ProbeError(Exception): ...


@dataclass(frozen=True, slots=True)
class Probe:
    path: PathLike[str]
    formats: frozenset[str]
    container: str
    duration: str | None
    videos: tuple[Stream, ...]
    audios: tuple[Stream, ...]
    subtitles: tuple[Stream, ...]
    default_audio: Stream | None

    def direct(self, *, audio: str) -> bool:
        return (
            bool(self.formats & MP4_FORMATS)
            and all(stream.codec == "h264" for stream in self.videos)
            and (self.default_audio is None or self.default_audio.codec == "aac")
            and audio == (self.default_audio.index if self.default_audio else "")
        )

    def command(
        self,
        *,
        audio: str,
        height: int | None,
        bitrate: int | None,
        time: str,
    ) -> Iterator[str | PathLike[str]]:
        video = next(iter(self.videos), None)
        yield from _source_command(path=self.path, time=time)

        if audio:
            selected = next(stream for stream in self.audios if stream.index == audio)
            yield from ("-map", f"0:{audio}")
            yield from ("-c:a", "copy" if selected.codec == "aac" else "aac")

        match video, height, bitrate:
            case None, _, _:
                pass
            case Stream() as video, None, _:
                yield from ("-map", f"0:{video.index}", "-c:v", "copy")
            case Stream() as video, int(height), int(bitrate):
                yield from ("-map", f"0:{video.index}")
                yield from (
                    "-c:v",
                    "libx264",
                    "-preset",
                    "veryfast",
                    "-pix_fmt",
                    "yuv420p",
                    "-vf",
                    _scale_filter(height=height),
                    "-b:v",
                    str(bitrate),
                )

        yield from _COMMAND_SUFFIX

    def subtitle_command(
        self,
        *,
        subtitle: Stream,
        time: str,
    ) -> tuple[str | PathLike[str], ...]:
        return (
            *_source_command(path=self.path, time=time),
            "-map",
            f"0:{subtitle.index}",
            "-f",
            "webvtt",
            "pipe:1",
        )


def _language(*, data: Mapping[Any, Any]) -> str:
    match data:
        case {"tags": {"language": str(language)}}:
            return language
        case _:
            return "und"


def _dimensions(*, data: Mapping[Any, Any]) -> tuple[int | None, int | None]:
    match data:
        case {"width": int(width), "height": int(height)}:
            return width, height
        case _:
            return None, None


def _parse_stream(*, data: dict[str, Any]) -> Stream:
    match data:
        case {
            "index": int(index),
            "codec_type": str(kind),
            "codec_name": str(codec),
            "disposition": {"default": int(default)},
            **metadata,
        }:
            width, height = _dimensions(data=metadata)
            return Stream(
                index=str(index),
                kind=kind,
                codec=codec,
                default=bool(default),
                language=_language(data=metadata),
                width=width,
                height=height,
            )
        case _:
            assert False


def _stream(*, data: object) -> Stream:
    match data:
        case dict() as data:
            return _parse_stream(data=data)
        case _:
            assert False


def _duration(*, data: Mapping[Any, Any]) -> str | None:
    match data:
        case {"duration": str(duration)}:
            return duration
        case _:
            return None


def _parse(*, path: Path, raw: dict[str, Any]) -> Probe:
    match raw:
        case {
            "format": {
                "format_name": str(format_name),
                "format_long_name": str(container),
                **format,
            },
            "streams": list() as streams,
        }:
            parsed = tuple(_stream(data=stream) for stream in streams)
            videos = tuple(stream for stream in parsed if stream.kind == "video")
            audios = tuple(stream for stream in parsed if stream.kind == "audio")
            subtitles = tuple(
                stream
                for stream in parsed
                if stream.kind == "subtitle" and stream.codec in TEXT_SUBTITLES
            )
            return Probe(
                path=path,
                formats=frozenset(format_name.split(",")),
                container=container,
                duration=_duration(data=format),
                videos=videos,
                audios=audios,
                subtitles=subtitles,
                default_audio=next(
                    (stream for stream in audios if stream.default),
                    next(iter(audios), None),
                ),
            )
        case _:
            assert False


@lru_cache
def _probe(path: Path, modified: int) -> dict[str, Any]:
    proc = run(
        (
            "ffprobe",
            "-v",
            "error",
            "-show_format",
            "-show_streams",
            "-of",
            "json",
            "--",
            path,
        ),
        capture_output=True,
        check=True,
        text=True,
        timeout=30,
    )

    match (json := loads(proc.stdout)):
        case dict() as raw:
            return raw
        case _:
            assert False, json


def probe(*, path: Path) -> Probe:
    try:
        raw = _probe(path, path.stat().st_mtime_ns)
        return _parse(path=path, raw=raw)
    except (
        CalledProcessError,
        JSONDecodeError,
        OSError,
        TimeoutExpired,
    ) as error:
        raise ProbeError(path) from error
