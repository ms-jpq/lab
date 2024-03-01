from argparse import ArgumentParser, Namespace
from contextlib import suppress
from pathlib import Path
from pprint import pprint
from sys import exit, stderr

from elasticsearch import Elasticsearch, NotFoundError

from .ls import ls



def _parse_args() -> Namespace:
    parser = ArgumentParser()
    parser.add_argument("--debug", action="store_true")
    parser.add_argument("--host", default="http://localhost:9200")
    parser.add_argument("--index", default="smb0")
    parser.add_argument("--nuke", action="store_true")
    parser.add_argument("path", type=Path)
    return parser.parse_args()


def main() -> None:
    args = _parse_args()
    debug, index = bool(args.debug), str(args.index)

    es = Elasticsearch(hosts=(args.host,))

    if debug:
        pprint(es.info(), stream=stderr)
        for name, info in es.indices.get(index="*").body.items():
            pprint(name, stream=stderr)
            pprint(info, stream=stderr)

    if args.nuke:
        with suppress(NotFoundError):
            resp = es.indices.delete(index=index)
            pprint(resp, stream=stderr)

    dir = Path(args.path).resolve(strict=True).as_posix().encode()
    for stat in ls(dir, debug=debug):
        break


try:
    main()
except KeyboardInterrupt:
    exit(130)
