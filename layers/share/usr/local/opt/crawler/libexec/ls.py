from collections.abc import Iterator
from dataclasses import dataclass
from datetime import datetime, timezone
from grp import getgrgid
from io import BufferedIOBase
from itertools import chain
from locale import getpreferredencoding
from logging import getLogger
from mimetypes import guess_type
from os import environ, stat, stat_result
from os.path import basename, commonpath, isabs, realpath, splitext
from posixpath import sep
from pwd import getpwuid
from stat import S_ISDIR, S_ISLNK
from subprocess import PIPE, Popen
from typing import Optional, Tuple, cast


@dataclass(frozen=True)
class _Stat:
    ext: Optional[bytes]
    gid: int
    group: str
    is_dir: bool
    itime: datetime
    mime: Optional[str]
    mtime: datetime
    name: bytes
    path: bytes
    size: int
    uid: int
    user: str


def _scandir(cwd: bytes) -> Iterator[bytes]:
    argv = (
        "fd",
        "--hidden",
        "--no-ignore-vcs",
        "--print0",
        "--show-errors",
        "--absolute-path",
    )
    with Popen(argv, cwd=cwd, stdout=PIPE) as proc:
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
            yield bytes(acc)


def _get_username(uid: int) -> str:
    try:
        return getpwuid(uid).pw_name
    except KeyError:
        return str(uid)


def _get_groupname(gid: int) -> str:
    try:
        return getgrgid(gid).gr_name
    except KeyError:
        return str(gid)


def _probedir(
    dir: bytes, encoding: str, debug: bool
) -> Iterator[Tuple[bytes, stat_result]]:
    assert isabs(dir)
    log = getLogger()
    for path in _scandir(dir):
        try:
            st = stat(path, follow_symlinks=False)
            if S_ISLNK(st.st_mode):
                linked = realpath(path)
                if not commonpath((linked, dir)) == dir:
                    continue
                st = stat(linked, follow_symlinks=True)
        except FileNotFoundError:
            continue
        except OSError as e:
            if debug:
                raise e
            log.warning("%s\n%s", path.decode(encoding), e)
        else:
            yield path, st


def ls(dir: bytes, debug: bool) -> Iterator[_Stat]:
    encoding = getpreferredencoding()
    for path, st in _probedir(dir, encoding=encoding, debug=debug):
        is_dir = S_ISDIR(st.st_mode)
        name = basename(path)

        if is_dir:
            ext = None
        else:
            _, ext = splitext(name)

        try:
            base = name.decode(encoding)
        except UnicodeDecodeError:
            mime = None
        else:
            mimetype, _ = guess_type(base, strict=False)
            mime, _, _ = (mimetype or "").partition(sep)
            mime = mime or None

        stat = _Stat(
            ext=ext,
            gid=st.st_gid,
            group=_get_groupname(st.st_gid),
            is_dir=is_dir,
            itime=datetime.now(timezone.utc),
            mime=mime,
            mtime=datetime.fromtimestamp(st.st_mtime),
            name=name,
            path=path,
            size=st.st_size,
            uid=st.st_uid,
            user=_get_username(st.st_uid),
        )
        yield stat
