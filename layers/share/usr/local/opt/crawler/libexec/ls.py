from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timezone
from functools import partial
from io import BufferedIOBase
from itertools import chain
from locale import getpreferredencoding
from logging import getLogger
from mimetypes import guess_type
from os import stat_result
from pathlib import Path, PurePath
from stat import S_ISDIR, S_ISLNK
from subprocess import DEVNULL, PIPE, Popen
from uuid import NAMESPACE_URL, UUID, uuid5


@dataclass(frozen=True)
class Stat:
    ext: str | None
    gid: int
    id: UUID
    is_dir: bool
    itime: datetime
    mime: str | None
    mtime: datetime
    name: str
    path: PurePath
    size: int
    uid: int


def _scandir(cwd: PurePath) -> Iterator[bytes | bytearray]:
    with Popen(
        (
            "fdfind",
            "--hidden",
            "--no-ignore-vcs",
            "--print0",
            "--show-errors",
            "--absolute-path",
        ),
        cwd=cwd,
        stdin=DEVNULL,
        stdout=PIPE,
    ) as proc:
        assert proc.stdout
        io = cast(BufferedIOBase, proc.stdout)

        acc = bytearray()
        while buf := io.read1():
            while (idx := buf.find(b"\0")) != -1:
                if acc:
                    yield bytes(chain(acc, buf[:idx]))
                else:
                    yield buf[:idx]
                acc.clear()
                buf = buf[idx + 1 :]
            if buf:
                acc.extend(buf)

        if acc:
            yield acc


def _scan(encoding: str, cwd: PurePath) -> Iterator[Path]:
    for b in _scandir(cwd):
        try:
            s = b.decode(encoding)
        except UnicodeDecodeError as e:
            getLogger().warning("%s\n%s", b, e)
        else:
            yield Path(s)


def _stat(path: PurePath, st: stat_result) -> Stat:
    is_dir = S_ISDIR(st.st_mode)
    mime, _ = guess_type(path.name, strict=False)
    stat = Stat(
        ext=None if is_dir else path.suffix,
        gid=st.st_gid,
        id=uuid5(namespace=NAMESPACE_URL, name=path.as_uri()),
        is_dir=is_dir,
        itime=datetime.now(timezone.utc),
        mime=mime,
        mtime=datetime.fromtimestamp(st.st_mtime),
        name=path.name,
        path=path,
        size=st.st_size,
        uid=st.st_uid,
    )
    return stat


def _os_stat(path: Path, dir: PurePath, debug: bool) -> Stat | None:
    try:
        st = path.stat(follow_symlinks=False)
        if S_ISLNK(st.st_mode):
            linked = path.resolve(strict=True)
            if not linked.is_relative_to(dir):
                return None
            st = linked.stat(follow_symlinks=True)
    except FileNotFoundError:
        return None
    except OSError as e:
        if debug:
            raise e
        getLogger().warning("%s\n%s", path, e)
        return None
    else:
        return _stat(path, st=st)


def ls(ex: ThreadPoolExecutor, dir: Path, debug: bool) -> Iterator[Stat]:
    assert dir.is_absolute()
    encoding = getpreferredencoding()

    for st in ex.map(
        partial(_os_stat, dir=dir, debug=debug),
        _scan(encoding, cwd=dir),
    ):
        if st:
            yield st
