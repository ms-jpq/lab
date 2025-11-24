from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import nullcontext
from functools import partial
from http import HTTPStatus
from http.server import HTTPServer
from logging import getLogger
from os import environ

from . import SESSION, loop, queue, srv

with nullcontext():
    _API = f"http://{environ['AWS_LAMBDA_RUNTIME_API']}/2020-01-01/extension"


def _loop(srv: HTTPServer) -> None:
    with SESSION.post(
        f"{_API}/register",
        json={"events": ["SHUTDOWN"]},
        headers={"Lambda-Extension-Name": "otlp.sh"},
    ) as r:
        assert r.status_code == HTTPStatus.OK, (r.status_code, r.json())
        id = r.headers["Lambda-Extension-Identifier"]

    try:
        with SESSION.get(
            f"{_API}/event/next", headers={"Lambda-Extension-Identifier": id}
        ) as r:
            assert r.status_code == HTTPStatus.OK, (r.status_code, r.json())
            queue().put_nowait(None)
    except Exception as e:
        getLogger().error("%s", e)
    finally:
        srv.shutdown()


def main() -> None:
    server = srv()
    with ThreadPoolExecutor() as ex:
        futs = tuple(
            ex.submit(f)
            for f in (partial(_loop, server), lambda: server.serve_forever(0.06), loop)
        )
        for f in as_completed(futs):
            f.result()


if __name__ == "__main__":
    main()
