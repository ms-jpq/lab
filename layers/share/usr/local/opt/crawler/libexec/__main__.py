from argparse import ArgumentParser, Namespace
from collections.abc import Iterator
from datetime import datetime
from grp import getgrgid
from io import BufferedIOBase
from locale import getpreferredencoding
from logging import getLogger
from mimetypes import guess_type
from os import stat, stat_result
from os.path import basename, commonpath, isabs, realpath
from pathlib import Path
from posixpath import sep
from pwd import getpwuid
from stat import S_ISDIR, S_ISLNK, filemode
from subprocess import PIPE, Popen
from sys import exit
from typing import Optional, Tuple, cast

# from elasticsearch import Elasticsearch

# es = Elasticsearch()


def _parse_args() -> Namespace:
    parser = ArgumentParser()
    parser.add_argument("--host", type=str, default="localhost")
    parser.add_argument("--port", type=int, default=9200)
    parser.add_argument("path", type=Path)
    return parser.parse_args()


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


# is_dir = S_ISDIR(st.st_mode)
# size = st.st_size
# date_mod = datetime.fromtimestamp(st.st_mtime)
# user = _get_username(st.st_uid)
# group = _get_groupname(st.st_gid)


def _probedir(dir: bytes) -> Iterator[Tuple[bytes, Optional[str], stat_result]]:
    assert isabs(dir)
    log = getLogger()
    encoding = getpreferredencoding()
    for path in _scandir(dir):
        name = basename(path)
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
            yield path, m_type, st


def main() -> None:
    args = _parse_args()
    dir = Path(args.path).resolve(strict=True).as_posix().encode()
    _probedir(dir)


try:
    main()
except KeyboardInterrupt:
    exit(130)
