#!/usr/bin/env -S -- PYTHONSAFEPATH= python3

from argparse import ArgumentParser
from contextlib import nullcontext
from io import DEFAULT_BUFFER_SIZE, BufferedIOBase
from os import linesep
from pathlib import Path
from signal import SIG_DFL, SIGPIPE, signal
from sys import stderr, stdin, stdout
from time import monotonic
from typing import cast

with nullcontext():
    _SEP, _EQ = linesep.encode("ascii"), b"="
    _CURSOR = b"__CURSOR"


with nullcontext():
    parser = ArgumentParser()
    parser.add_argument("--flush", type=float, default=60.0)
    parser.add_argument("--name", required=True)
    parser.add_argument("cursor_fd")
    args = parser.parse_args()
    name, flush = str(args.name).encode(), args.flush
    record = Path(f"{args.cursor_fd}.cursor")
    wal = record.with_suffix(".wal")


with nullcontext():
    io = cast(BufferedIOBase, stdin.buffer).raw
    acc = bytearray()
    t0 = monotonic()
    binary = 0
    count = 0
    cursor = b""


def _flush(delta: float) -> None:
    if cursor:
        wal.write_bytes(cursor)
        wal.rename(record)
        line = (
            name
            + b" : "
            + str(count).encode()
            + b"/"
            + format(delta, ".2f").encode()
            + b"s"
            + _SEP
        )
        stderr.buffer.write(line)
        stderr.buffer.flush()


signal(SIGPIPE, SIG_DFL)


try:
    while True:
        if binary < 0:
            if not (buf := io.read(1)):
                break

            binary, *_ = buf
        elif binary:
            if not (buf := io.read(binary)):
                break

            binary -= len(buf)
        else:
            if not (buf := io.readline(DEFAULT_BUFFER_SIZE)):
                break

            if buf[-1:] == _SEP:
                if len(buf) == 1:
                    count += 1
                    t1 = monotonic()
                    if (delta := t1 - t0) >= flush:
                        t0 = t1
                        _flush(delta)
                    stdout.buffer.flush()
                else:
                    view = acc or buf
                    if (idx := view.find(_EQ)) < 0:
                        binary = -1
                    elif view[:idx] == _CURSOR:
                        cursor = view[idx + 1 : -len(_SEP)]
                    acc.clear()
            else:
                acc.extend(buf)

        stdout.buffer.write(buf)
except KeyboardInterrupt:
    exit(130)
except BrokenPipeError:
    exit(13)
finally:
    _flush(t0 - monotonic())
