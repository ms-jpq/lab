from argparse import ArgumentParser, Namespace
from collections.abc import Iterator, MutableSet
from contextlib import suppress
from json import loads
from os import environ
from pathlib import Path, PurePath
from pprint import pprint
from sys import exit, stderr
from threading import Lock
from typing import Any, Dict

from elasticsearch import Elasticsearch, NotFoundError
from elasticsearch.helpers import parallel_bulk

from .ls import Stat, ls


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


def _init(es: Elasticsearch, index: str, nuke: bool, debug: bool) -> None:
    if debug:
        pprint(es.info(), stream=stderr)
        for name, info in es.indices.get(index="*").body.items():
            pprint(name, stream=stderr)
            pprint(info, stream=stderr)

    if nuke:
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


def _trans(st: Stat) -> Dict[str, Any]:
    return {}


def main() -> None:
    args = _parse_args()
    debug, index = bool(args.debug), str(args.index)
    dir = Path(args.path).resolve(strict=True)

    es = Elasticsearch(hosts=(args.host,))
    _init(es, index=index, nuke=args.nuke, debug=debug)

    lock = Lock()
    acc: MutableSet[PurePath] = set()

    def cont() -> Iterator[Dict[str, Any]]:
        for st in ls(dir, debug=debug):
            with lock:
                acc.add(st.path)
            yield _trans(st)

    for ok, resp in parallel_bulk(client=es, actions=cont()):
        if not ok and debug:
            pprint(resp, stream=stderr)


try:
    main()
except KeyboardInterrupt:
    exit(130)
