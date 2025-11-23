from concurrent.futures import ThreadPoolExecutor
from contextlib import nullcontext
from http import HTTPStatus
from logging import getLogger
from os import environ
from pathlib import PurePath

from . import SESSION, loop, srv

with nullcontext():

    _API = f"http://{environ['AWS_LAMBDA_RUNTIME_API']}/2020-01-01/extension"


def _init() -> None:
    with SESSION.post(
        f"{_API}/register",
        json={"events": ["SHUTDOWN"]},
        headers={"Lambda-Extension-Name": PurePath(__file__).parent.name},
    ) as r:
        getLogger().info("%s", r)
        # assert r.status_code == HTTPStatus.OK


def main() -> None:
    with ThreadPoolExecutor() as ex:
        _init()
        tuple(ex.map(lambda f: f(), (srv, loop)))


if __name__ == "__main__":
    main()
