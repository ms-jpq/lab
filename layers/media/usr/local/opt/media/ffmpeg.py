from __future__ import annotations

from collections.abc import Iterator, Mapping
from dataclasses import dataclass
from functools import lru_cache
from io import BufferedReader
from json import JSONDecodeError, loads
from os import PathLike
from pathlib import Path
from re import compile
from subprocess import DEVNULL, PIPE, CalledProcessError, Popen, TimeoutExpired, run
from typing import Any, cast

TEXT_SUBTITLES = frozenset(
    {"ass", "mov_text", "srt", "ssa", "subrip", "text", "webvtt"}
)
MP4_FORMATS = frozenset({"3g2", "3gp", "mj2", "mov", "mp4", "m4a"})

_COMMAND_PREFIX = ("nice", "--adjustment=19", "--", "ffmpeg", "-v", "error", "-nostdin")
_VAAPI_DEVICE = "/dev/dri/renderD128"
_H264_VAAPI_QP = "25"
_ASS_OVERRIDE = compile(rb"\{[^}\r\n]*\\[^}\r\n]*\}")
_COMMAND_SUFFIX = (
    "-movflags",
    "frag_keyframe+empty_moov+default_base_moof",
    "-flush_packets",
    "1",
    "-f",
    "mp4",
    "pipe:1",
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


def _bytes(*, command: tuple[str | PathLike[str], ...]) -> Iterator[bytes]:
    with Popen(command, stdin=DEVNULL, stdout=PIPE) as proc:
        reader = cast(BufferedReader, proc.stdout)

        try:
            yield from iter(reader.read1, b"")
        finally:
            proc.kill()


def _command(
    *,
    path: PathLike[str],
    videos: tuple[Stream, ...],
    audios: tuple[Stream, ...],
    audio: str,
    height: int | None,
    time: str,
) -> Iterator[str | PathLike[str]]:
    yield from _COMMAND_PREFIX

    video = next(iter(videos), None)
    match video:
        case Stream():
            yield from ("-vaapi_device", _VAAPI_DEVICE)
        case None:
            pass
    yield from ("-ss", time, "-i", path)

    if audio:
        selected = next(stream for stream in audios if stream.index == audio)
        yield from ("-map", f"0:{audio}")
        yield from ("-c:a", "copy" if selected.codec == "aac" else "aac")

    match video, height:
        case None, _:
            pass
        case Stream() as video, height:
            yield from ("-map", f"0:{video.index}")
            yield from (
                "-c:v",
                "h264_vaapi",
                "-qp",
                _H264_VAAPI_QP,
                "-vf",
                (
                    "format=nv12,hwupload"
                    if height is None
                    else f"{_scale_filter(height=height)},format=nv12,hwupload"
                ),
            )

    yield from _COMMAND_SUFFIX


def _subtitle_command(
    *, path: PathLike[str], subtitle: Stream, time: str
) -> tuple[str | PathLike[str], ...]:
    return (
        *_COMMAND_PREFIX,
        "-i",
        path,
        "-ss",
        time,
        "-map",
        f"0:{subtitle.index}",
        "-output_ts_offset",
        f"-{time}",
        "-f",
        "webvtt",
        "pipe:1",
    )


def _clean_subtitles(source: Iterator[bytes]) -> Iterator[bytes]:
    pending: list[bytes] = []
    for chunk in source:
        complete, separator, tail = chunk.rpartition(b"\n")
        if separator:
            pending.extend((complete, separator))
            yield _ASS_OVERRIDE.sub(b"", b"".join(pending))
            pending = [tail] if tail else []
        else:
            pending.append(tail)

    if pending:
        yield _ASS_OVERRIDE.sub(b"", b"".join(pending))


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

    def direct_content_type(self, *, audio: str) -> str | None:
        match self.videos, self.default_audio:
            case videos, None if (
                not audio
                and self.formats & MP4_FORMATS
                and all(stream.codec == "h264" for stream in videos)
            ):
                return "video/mp4"

            case videos, Stream(index=index, codec="aac") if (
                audio == index
                and self.formats & MP4_FORMATS
                and all(stream.codec == "h264" for stream in videos)
            ):
                return "video/mp4" if videos else "audio/mp4"

            case (), Stream(index=index, codec="mp3") if (
                audio == index and "mp3" in self.formats
            ):
                return "audio/mpeg"

            case _:
                return None

    def stream(
        self,
        *,
        audio: str,
        height: int | None,
        time: str,
    ) -> Iterator[bytes]:
        yield from _bytes(
            command=tuple(
                _command(
                    path=self.path,
                    videos=self.videos,
                    audios=self.audios,
                    audio=audio,
                    height=height,
                    time=time,
                )
            )
        )

    def subtitle(
        self,
        *,
        subtitle: Stream,
        time: str,
    ) -> Iterator[bytes]:
        st = _bytes(
            command=_subtitle_command(
                path=self.path,
                subtitle=subtitle,
                time=time,
            )
        )
        yield from _clean_subtitles(st)


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


def probe(*, path: Path, modified: int) -> Probe:
    try:
        raw = _probe(path, modified)
        return _parse(path=path, raw=raw)
    except (
        CalledProcessError,
        JSONDecodeError,
        OSError,
        TimeoutExpired,
    ) as error:
        raise ProbeError(path) from error
