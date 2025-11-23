from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import nullcontext
from http import HTTPStatus
from logging import getLogger
from os import environ

from . import SESSION, loop, queue, srv

with nullcontext():

    _API = f"http://{environ['AWS_LAMBDA_RUNTIME_API']}/2020-01-01/extension"


def _loop() -> None:
    with SESSION.post(
        f"{_API}/register",
        json={"events": ["SHUTDOWN"]},
        headers={"Lambda-Extension-Name": "otlp.sh"},
    ) as r:
        assert r.status_code == HTTPStatus.OK, (r.status_code, r.text)
        id = r.headers["Lambda-Extension-Identifier"]

    while True:
        try:
            with SESSION.get(
                f"{_API}/event/next", headers={"Lambda-Extension-Identifier": id}
            ) as r:
                assert r.status_code == HTTPStatus.OK, (r.status_code, r.text)
                queue().put_nowait(None)
        except Exception as e:
            getLogger().error("%s", e)


def main() -> None:
    with ThreadPoolExecutor() as ex:
        futs = tuple(ex.submit(f) for f in (_loop, srv, loop))
        for f in as_completed(futs):
            f.result()


if __name__ == "__main__":
    main()
