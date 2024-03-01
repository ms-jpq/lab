from argparse import ArgumentParser, Namespace
from collections.abc import Iterator, MutableSet
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager, suppress
from json import loads
from os import environ
from pathlib import Path
from pprint import pprint
from sys import exit, stderr
from typing import Any, Dict
from uuid import UUID

from elasticsearch import Elasticsearch, NotFoundError
from elasticsearch.helpers import streaming_bulk

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
        pprint(es.info().body, stream=stderr)

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


def _trans(index: str, st: Stat) -> Dict[str, Any]:
    doc = {
        "attributes": {
            "group": st.gid,
            "owner": st.uid,
        },
        "file": {
            "content_type": st.mime,
            "extension": st.ext,
            "filename": st.name,
            "filesize": st.size,
            "indexing_date": st.itime.isoformat(),
            "last_modified": st.mtime.isoformat(),
        },
        "path": {
            "real": st.path.as_posix(),
        },
    }
    cmd = {
        "_index": index,
        "_id": str(st.id),
        "_source": doc,
    }
    return cmd


@contextmanager
def _ex() -> Iterator[ThreadPoolExecutor]:
    with ThreadPoolExecutor() as ex:
        try:
            yield ex
        except:
            ex.shutdown(wait=False, cancel_futures=True)
            raise


def main() -> None:
    args = _parse_args()
    debug, index = bool(args.debug), str(args.index)
    dir = Path(args.path).resolve(strict=True)
    chunksize = 1 if debug else 69

    es = Elasticsearch(hosts=(args.host,))
    _init(es, index=index, nuke=args.nuke, debug=debug)

    acc: MutableSet[UUID] = set()
    with _ex() as ex:

        def cont() -> Iterator[Dict[str, Any]]:
            for st in ls(ex, dir=dir, debug=debug):
                acc.add(st.id)
                yield _trans(index, st=st)

        for ok, resp in streaming_bulk(client=es, actions=cont(), chunk_size=chunksize):
            assert ok
            if debug:
                pprint(resp, stream=stderr)


try:
    main()
except KeyboardInterrupt:
    exit(130)
