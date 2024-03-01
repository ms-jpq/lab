from collections.abc import Iterator
from dataclasses import dataclass
from datetime import datetime, timezone
from grp import getgrgid
from io import BufferedIOBase
from locale import getpreferredencoding
from logging import getLogger
from mimetypes import guess_type
from os import stat, stat_result
from os.path import commonpath, isabs, realpath, splitext
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
            if acc:
                yield acc
                acc.clear()
            while (idx := buf.find(b"\0")) != -1:
                yield buf[:idx]
                buf = buf[idx + 1 :]
            if buf:
                acc.extend(buf)


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
    dir: bytes,
) -> Iterator[Tuple[bytes, bytes, Optional[bytes], Optional[str], stat_result]]:
    assert isabs(dir)
    log = getLogger()
    encoding = getpreferredencoding()
    for path in _scandir(dir):
        name, ext = splitext(path)
        try:
            base = name.decode(encoding)
        except UnicodeDecodeError:
            m_type = None
        else:
            mime, _ = guess_type(base, strict=False)
            m_type, _, _ = (mime or "").partition(sep)
            m_type = m_type or None

        try:
            st = stat(path, follow_symlinks=False)
            if S_ISLNK(st.st_mode):
                linked = realpath(path)
                if not commonpath((linked, dir)) == dir:
                    continue
                st = stat(linked, follow_symlinks=True)
        except OSError as e:
            log.warning("%s\n%s", path.decode(encoding), e)
        else:
            yield path, name, ext or None, m_type, st


def ls(dir: bytes) -> Iterator[_Stat]:
    for path, name, ext, mime, st in _probedir(dir):
        stat = _Stat(
            ext=ext,
            gid=st.st_gid,
            group=_get_groupname(st.st_gid),
            is_dir=S_ISDIR(st.st_mode),
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
