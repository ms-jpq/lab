from contextlib import suppress
from os import killpg
from signal import SIGKILL, SIGTERM
from subprocess import Popen


def terminate(process: Popen[bytes]) -> None:
    with suppress(ProcessLookupError):
        killpg(process.pid, SIGTERM)
    with suppress(TimeoutError):
        process.wait(timeout=2)
    if process.poll() is None:
        with suppress(ProcessLookupError):
            killpg(process.pid, SIGKILL)
