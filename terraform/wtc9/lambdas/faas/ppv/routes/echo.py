from collections.abc import Mapping
from typing import Any

from . import app


@app.route("/echo", method=["DELETE", "GET", "POST", "PUT"])
def route() -> Mapping[str, Any]:
    return app.current_event.raw_event
