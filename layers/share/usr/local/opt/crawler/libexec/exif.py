from collections.abc import Callable, Mapping
from dataclasses import dataclass
from itertools import chain, repeat
from logging import getLogger
from pathlib import PurePath
from subprocess import DEVNULL, PIPE, Popen
from typing import Any, Iterator, Optional, Tuple


@dataclass(frozen=True)
class Exif:
    height: Optional[int] = None
    raw_x: Optional[int] = None
    raw_y: Optional[int] = None
    width: Optional[int] = None


def _parse_int(s: bytes) -> int:
    return int(s.decode())


_KEYS: Mapping[bytes, Tuple[str, Callable[[bytes], Any]]] = {
    b"Exif.Image.XResolution": ("raw_x", _parse_int),
    b"Exif.Image.YResolution": ("raw_y", _parse_int),
    b"Exif.Photo.PixelXDimension": ("width", _parse_int),
    b"Exif.Photo.PixelYDimension": ("height", _parse_int),
}


def _parse(path: PurePath) -> Iterator[Tuple[str, Any]]:
    with Popen(
        (
            b"exiv2",
            b"-p",
            b"a",
            *chain.from_iterable(zip(repeat(b"-K"), _KEYS)),
            b"--",
            path,
        ),
        stdin=DEVNULL,
        stdout=PIPE,
    ) as proc:
        assert proc.stdout
        for line in proc.stdout:
            key, _, _, val = line.split(maxsplit=3)
            new_key, parse = _KEYS[key]
            value = parse(val)
            yield new_key, value


def exif(path: PurePath, mime: Optional[str], debug: bool) -> Optional[Exif]:
    if mime in ("image/jpeg", "image/tiff"):
        try:
            exif = Exif(**{k: v for k, v in _parse(path)})
        except Exception as e:
            if debug:
                raise e
            getLogger().warning("%s\n%s", path, e)
        else:
            return exif

    return None
