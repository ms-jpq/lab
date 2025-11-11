from urllib.parse import parse_qsl


def parse_params(body: str | None) -> dict[str, str]:
    return dict(parse_qsl(body))
