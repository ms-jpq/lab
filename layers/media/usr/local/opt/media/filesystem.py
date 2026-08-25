from __future__ import annotations

from enum import StrEnum
from pathlib import Path, PurePosixPath
from posixpath import curdir, pardir
from urllib.parse import unquote


class EntryKind(StrEnum):
    DIRECTORY = "dir"
    FILE = "file"


def _entry_kind(*, path: Path) -> EntryKind | None:
    if path.is_dir():
        return EntryKind.DIRECTORY
    if path.is_file():
        return EntryKind.FILE
    return None


def _entry_order(entry: tuple[Path, EntryKind]) -> tuple[bool, str, str]:
    path, kind = entry
    return kind is EntryKind.FILE, path.name.casefold(), path.name


def entries(*, path: Path, needle: str) -> tuple[tuple[Path, EntryKind], ...]:
    return tuple(
        sorted(
            (
                (entry, kind)
                for entry in path.iterdir()
                if (kind := _entry_kind(path=entry)) is not None
                and (not needle or needle in entry.name.casefold())
            ),
            key=_entry_order,
        )
    )


def resolve(*, root: Path, raw: str) -> tuple[PurePosixPath, Path] | None:
    path = PurePosixPath(unquote(raw))
    if not path.is_absolute() or any(part in {curdir, pardir} for part in path.parts):
        return None

    relative = PurePosixPath(*path.parts[1:])
    target = root.joinpath(*relative.parts).resolve(strict=False)
    if not target.is_relative_to(root):
        return None
    return relative, target
