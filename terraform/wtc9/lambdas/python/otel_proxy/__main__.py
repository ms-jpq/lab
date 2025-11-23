from contextlib import nullcontext
from os import environ

from requests import Session

with nullcontext():
    _SESSION = Session()

    LAMBDA_EXTENSION_API = (
        f"http://{environ['AWS_LAMBDA_RUNTIME_API']}/2020-01-01/extension"
    )


def main():
    response = _SESSION.post(
        f"{LAMBDA_EXTENSION_API}/register",
        json={"events": ["SHUTDOWN"]},
        headers={"Lambda-Extension-Name": "otel-proxy"},
    )
    extension_id = response.headers["Lambda-Extension-Identifier"]

    # Event loop
    while True:
        response = _SESSION.get(
            f"{LAMBDA_EXTENSION_API}/event/next",
            headers={"Lambda-Extension-Identifier": extension_id},
        )
        event = response.json()

        if event["eventType"] == "INVOKE":
            pass
        elif event["eventType"] == "SHUTDOWN":
            pass


if __name__ == "__main__":
    main()
