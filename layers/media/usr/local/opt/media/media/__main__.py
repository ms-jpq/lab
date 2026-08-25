#!/usr/bin/env -S -- PYTHONSAFEPATH= python3

from argparse import ArgumentParser, Namespace
from contextlib import nullcontext
from logging import INFO, basicConfig, captureWarnings
from pathlib import Path

from .http import serve

with nullcontext():
    captureWarnings(True)
    basicConfig(format="%(message)s", level=INFO, force=True)


def _parse_args() -> Namespace:
    parser = ArgumentParser()
    parser.add_argument("--root", required=True, type=Path)
    parser.add_argument("--socket", required=True, type=Path)
    return parser.parse_args()


def _main() -> None:
    args = _parse_args()
    serve(root=args.root, socket=args.socket)


if __name__ == "__main__":
    _main()
