from collections.abc import Mapping
from logging import getLogger
from pprint import pformat
from typing import Any

from . import app


@app.route("/echo", method=["DELETE", "GET", "HEAD", "POST", "PUT"])
def route() -> Mapping[str, Any]:
    event = app.current_event.raw_event
    getLogger().info("%s", pformat(event))
    return event
