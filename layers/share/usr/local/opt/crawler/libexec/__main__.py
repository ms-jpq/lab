from argparse import ArgumentParser, Namespace
from pathlib import Path
from sys import exit

from .ls import ls

# from elasticsearch import Elasticsearch

# es = Elasticsearch()


def _parse_args() -> Namespace:
    parser = ArgumentParser()
    parser.add_argument("--host", type=str, default="localhost")
    parser.add_argument("--port", type=int, default=9200)
    parser.add_argument("path", type=Path)
    return parser.parse_args()


def main() -> None:
    args = _parse_args()
    dir = Path(args.path).resolve(strict=True).as_posix().encode()
    for stat in ls(dir):
        print(stat)


try:
    main()
except KeyboardInterrupt:
    exit(130)
