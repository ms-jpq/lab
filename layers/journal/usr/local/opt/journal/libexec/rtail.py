#!/usr/bin/env -S -- PYTHONSAFEPATH= python3

from argparse import ArgumentParser
from contextlib import nullcontext
from io import DEFAULT_BUFFER_SIZE, BufferedIOBase
from os import kill, linesep
from pathlib import Path
from signal import Handlers, Signals, signal
from sys import exit, stderr, stdin, stdout
from time import monotonic
from typing import cast

with nullcontext():
    _SEP, _EQ = linesep.encode("ascii"), b"="
    _CURSOR = b"__CURSOR"


with nullcontext():
    parser = ArgumentParser()
    parser.add_argument("--ppid", type=int, required=True)
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
        msg_p_s = count / delta
        line = (
            name
            + b" : "
            + format(msg_p_s, ".2f").encode()
            + b"/s -> "
            + str(count).encode()
            + b"/"
            + format(delta, ".2f").encode()
            + b"s"
            + _SEP
        )
        stderr.buffer.write(line)
        stderr.buffer.flush()


signal(Signals.SIGPIPE, Handlers.SIG_DFL)


try:
    while True:
        blit = False
        if binary < 0:
            if not (buf := io.read(-binary)):
                break

            binary += len(buf)
            acc.extend(buf)
            if not binary:
                binary = int.from_bytes(acc, byteorder="little") + 1
                acc.clear()
        elif binary > 0:
            if not (buf := io.read(binary)):
                break

            binary -= len(buf)
        else:
            if not (buf := io.readline(DEFAULT_BUFFER_SIZE)):
                break

            if buf[-1:] == _SEP:
                if len(buf) == 1:
                    count += 1
                    blit = True
                else:
                    view = acc or buf
                    if (idx := view.find(_EQ)) < 0:
                        binary = -8
                    elif view[:idx] == _CURSOR:
                        cursor = view[idx + 1 : -len(_SEP)]
                    acc.clear()
            else:
                acc.extend(buf)

        stdout.buffer.write(buf)
        if blit:
            stdout.buffer.flush()
            if monotonic() - t0 >= flush:
                stdout.close()
                _flush(monotonic() - t0)
                break
    kill(-args.ppid, Signals.SIGTERM)
except KeyboardInterrupt:
    exit(130)
except BrokenPipeError:
    exit(13)
