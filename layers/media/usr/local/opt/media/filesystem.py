from __future__ import annotations

from os import stat_result
from pathlib import Path, PurePosixPath
from posixpath import curdir, pardir
from stat import S_ISDIR, S_ISREG
from urllib.parse import unquote

type Entry = tuple[Path, stat_result]


class EntriesError(Exception): ...


def entry(*, path: Path) -> Entry | None:
    try:
        data = path.stat()
    except FileNotFoundError:
        return None
    if not S_ISDIR(data.st_mode) and not S_ISREG(data.st_mode):
        return None
    return path, data


def _entry_order(entry: Entry) -> tuple[bool, str, str]:
    path, data = entry
    return S_ISREG(data.st_mode), path.name.casefold(), path.name


def entries(*, path: Path) -> tuple[Entry, ...]:
    try:
        return tuple(
            sorted(
                (
                    selected
                    for child in path.iterdir()
                    if (selected := entry(path=child)) is not None
                ),
                key=_entry_order,
            )
        )
    except OSError as error:
        raise EntriesError(path) from error


def resolve(*, root: Path, raw: str) -> tuple[PurePosixPath, Path] | None:
    path = PurePosixPath(unquote(raw))
    if not path.is_absolute() or any(part in {curdir, pardir} for part in path.parts):
        return None

    relative = PurePosixPath(*path.parts[1:])
    try:
        target = root.joinpath(*relative.parts).resolve(strict=False)
    except (OSError, ValueError):
        return None
    if not target.is_relative_to(root):
        return None
    return relative, target
