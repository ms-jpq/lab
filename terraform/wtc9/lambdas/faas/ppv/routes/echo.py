from collections.abc import Mapping
from logging import getLogger
from pprint import pformat
from typing import Any

from . import TRACER, app


@app.route("/echo", method=["DELETE", "GET", "HEAD", "POST", "PUT"])
def route() -> Mapping[str, Any]:
    event = app.current_event.raw_event
    with TRACER.start_as_current_span("echo") as span:
        getLogger().info("%s", (fmt := pformat(event)))
        span.add_event("echoed", attributes={"pformat": fmt})

    return event
