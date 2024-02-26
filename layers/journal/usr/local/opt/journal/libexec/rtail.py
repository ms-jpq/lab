#!/usr/bin/env -S -- PYTHONSAFEPATH= python3

from argparse import ArgumentParser
from io import DEFAULT_BUFFER_SIZE, BufferedIOBase
from os import linesep
from sys import stdin, stdout
from typing import cast

_SEP, _EQ = linesep.encode(), b"="
_CURSOR = b"__CURSOR"


parser = ArgumentParser()
parser.add_argument("cursor_fd", nargs="?", default="/dev/stderr")
args = parser.parse_args()


io = cast(BufferedIOBase, stdin.buffer).raw
acc = bytearray()
binary = 0
count = 0
cursor = b""

with open(args.cursor_fd, mode="wb") as fd:
    while True:
        if binary:
            buf = io.read(binary)
            if not buf:
                break
            else:
                binary -= len(buf)
        else:
            buf = io.readline(DEFAULT_BUFFER_SIZE)
            if not buf:
                break
            else:
                if buf.endswith(_SEP):
                    if len(buf) == 1:
                        count += 1
                    else:
                        acc.extend(buf)
                        idx = acc.find(_EQ)
                        if idx == -1:
                            step = io.read(1)
                            if not step:
                                break
                            else:
                                binary, *_ = step
                        else:
                            key = acc[:idx]
                            if key == _CURSOR:
                                cursor = acc[idx + 1 : -len(_SEP)]
                                fd.write(cursor + _SEP)
                        acc.clear()
                else:
                    acc.extend(buf)

        stdout.buffer.write(buf)
