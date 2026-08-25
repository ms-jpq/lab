from __future__ import annotations

from enum import StrEnum
from pathlib import Path, PurePosixPath
from posixpath import curdir, pardir
from urllib.parse import unquote


class EntryKind(StrEnum):
    DIRECTORY = "dir"
    FILE = "file"


type Entry = tuple[Path, EntryKind, int | None]


class EntriesError(Exception): ...


def _entry(*, path: Path) -> Entry | None:
    if path.is_dir():
        return path, EntryKind.DIRECTORY, None
    if path.is_file():
        return path, EntryKind.FILE, path.stat().st_size
    return None


def _entry_order(entry: Entry) -> tuple[bool, str, str]:
    path, kind, _ = entry
    return kind is EntryKind.FILE, path.name.casefold(), path.name


def entries(*, path: Path) -> tuple[Entry, ...]:
    try:
        return tuple(
            sorted(
                (
                    entry
                    for child in path.iterdir()
                    if (entry := _entry(path=child)) is not None
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
