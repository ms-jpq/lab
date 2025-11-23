from collections.abc import Callable, Iterator
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager, nullcontext
from functools import cache, wraps
from json import dumps
from logging import getLogger
from os import environ
from traceback import format_exception
from typing import Any, TypeVar, cast

from boto3 import client
from botocore.config import Config
from opentelemetry.trace import get_current_span

from .telemetry import NAME

_F = TypeVar("_F", bound=Callable[..., Any])
_ = True

with nullcontext():
    B3_CONF = Config(retries={"mode": "adaptive"})

with nullcontext():
    SNS = client(service_name="sns", config=B3_CONF)


@cache
def chan() -> str:
    return environ["ENV_CHAN_NAME"]


@cache
def executor() -> ThreadPoolExecutor:
    return ThreadPoolExecutor()


@contextmanager
def suppress_exn() -> Iterator[None]:
    try:
        yield None
    except Exception as e:
        get_current_span().record_exception(e)
        getLogger().error("%s", e)


def report_exception() -> Callable[[_F], _F]:
    def cont(f: _F) -> _F:
        @wraps(f)
        def instrumented(*__args: Any, **__kwargs: Any) -> Any:
            try:
                f(*__args, **__kwargs)
            except Exception as e:
                with suppress_exn():
                    title = " ".join((NAME, type(e).__name__))
                    body = "".join(format_exception(e))
                    SNS.publish(TopicArn=chan(), Subject=title, Message=body)
                raise

        return cast(_F, instrumented)

    return cont


def dump_json(x: Any) -> str:
    return dumps(
        x,
        check_circular=False,
        ensure_ascii=False,
        allow_nan=False,
        indent=2,
        sort_keys=True,
    )
