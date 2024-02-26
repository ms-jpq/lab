#!/usr/bin/env -S -- PYTHONSAFEPATH= python3

from argparse import ArgumentParser
from contextlib import nullcontext
from io import DEFAULT_BUFFER_SIZE, BufferedIOBase
from os import linesep
from pathlib import Path
from signal import SIG_DFL, SIGPIPE, signal
from sys import stdin, stdout
from typing import cast

with nullcontext():
    _SEP, _EQ = linesep.encode("ascii"), b"="
    _CURSOR = b"__CURSOR"


with nullcontext():
    parser = ArgumentParser()
    parser.add_argument("--flush", type=int, default=10000)
    parser.add_argument("cursor_fd")
    args = parser.parse_args()
    flush = args.flush
    record = Path(f"{args.cursor_fd}.record")
    wal = record.with_suffix(".wal")


with nullcontext():
    io = cast(BufferedIOBase, stdin.buffer).raw
    acc = bytearray()
    binary = 0
    count = 0
    cursor = b""


def _flush() -> None:
    if cursor:
        wal.write_bytes(cursor)
        wal.rename(record)


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

            if buf.endswith(_SEP):
                if len(buf) == 1:
                    count += 1
                    if count % flush == 0:
                        _flush()
                else:
                    acc.extend(buf)
                    if (idx := acc.find(_EQ)) < 0:
                        binary = -1
                    else:
                        if acc[:idx] == _CURSOR:
                            cursor = acc[idx + 1 : -len(_SEP)]
                    acc.clear()
            else:
                acc.extend(buf)

        stdout.buffer.write(buf)
except KeyboardInterrupt:
    exit(130)
except BrokenPipeError:
    exit(13)
finally:
    _flush()
