from argparse import ArgumentParser, Namespace
from concurrent.futures import ThreadPoolExecutor
from contextlib import suppress
from json import loads
from os import environ
from pathlib import Path
from pprint import pprint
from sys import exit, stderr

from elasticsearch import Elasticsearch, NotFoundError

from .ls import ls


def _parse_args() -> Namespace:
    parser = ArgumentParser()
    parser.add_argument(
        "--debug", action="store_true", default="INVOCATION_ID" not in environ
    )
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

    try:
        resp = es.indices.get(index=index)
        if debug:
            pprint(resp, stream=stderr)
    except NotFoundError:
        json = Path(__file__).resolve(strict=True).with_name("mappings.json")
        mappings = loads(json.read_text())
        resp = es.indices.create(index=index, mappings=mappings)
        if debug:
            pprint(resp, stream=stderr)

    dir = Path(args.path).resolve(strict=True)
    with ThreadPoolExecutor() as ex:
        for stat in ls(ex, dir=dir, debug=debug):
            print(stat, flush=True)


try:
    main()
except KeyboardInterrupt:
    exit(130)
