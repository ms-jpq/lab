from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import nullcontext
from functools import partial
from http import HTTPStatus
from http.server import HTTPServer
from logging import getLogger
from os import environ
from signal import Signals, signal

from . import SESSION, srv

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
            assert r.status_code == HTTPStatus.OK, r.status_code
            match json := r.json():
                case {"eventType": "SHUTDOWN"}:
                    srv.shutdown()
                case _:
                    getLogger().info("%s", json)

    except Exception as e:
        getLogger().error("%s", e)
    finally:
        srv.shutdown()


def main() -> None:
    with ThreadPoolExecutor() as ex:
        server = srv(ex)
        signal(Signals.SIGTERM, lambda _, __: server.shutdown())

        futs = tuple(
            ex.submit(f)
            for f in (
                partial(_loop, server),
                partial(server.serve_forever, 0.06),
            )
        )
        for f in as_completed(futs):
            f.result()


if __name__ == "__main__":
    main()
