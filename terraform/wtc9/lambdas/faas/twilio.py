from base64 import b64encode
from collections.abc import Mapping
from functools import cache
from hashlib import sha1
from hmac import HMAC, compare_digest
from itertools import chain
from os import environ
from urllib.parse import parse_qsl


@cache
def _auth_key() -> bytes:
    return environ["ENV_TWILIO_TOKEN"].encode()


def parse_params(body: str | None) -> dict[str, str]:
    return dict(parse_qsl(body, keep_blank_values=True))


def verify(uri: str, params: Mapping[str, str], signature: str) -> bool:
    auth_msg = "".join(chain((uri,), chain.from_iterable(sorted(params.items()))))
    hmac = HMAC(_auth_key(), auth_msg.encode(), digestmod=sha1)
    expected = b64encode(hmac.digest()).decode()

    return compare_digest(signature, expected)
