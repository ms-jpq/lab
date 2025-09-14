#!/usr/bin/env -S -- PYTHONSAFEPATH= python3

from collections.abc import Iterable, Iterator
from functools import cache
from ipaddress import IPv6Address, IPv6Interface, IPv6Network
from os import environ
from pathlib import Path, PurePath
from re import RegexFlag, compile
from subprocess import check_call
from sys import stderr
from time import time
from typing import Literal

_LifeTime = Literal["forever"] | int


_PREFIX = compile(
    r"^\s*iaprefix\s+(?P<network>[^s]+)\s+\{(?P<lifetimes>.+)}$",
    flags=RegexFlag.MULTILINE | RegexFlag.DOTALL,
)
_TIMESTAMP = compile(
    r"^\s*starts\s+(\d+);$",
    flags=RegexFlag.MULTILINE,
)
_VALID = compile(
    r"^\s*max-life\s+(\d+);$",
    flags=RegexFlag.MULTILINE,
)
_PREFERRED = compile(
    r"^\s*preferred-life\s+(\d+);$",
    flags=RegexFlag.MULTILINE,
)

_DNS = compile(
    r"^\s*option dhcp6.name-servers\s+(.+);$",
    flags=RegexFlag.MULTILINE,
)


def _interface(net: IPv6Network, token: IPv6Address | None = None) -> IPv6Interface:
    addr = IPv6Address(int(net.network_address) | int(token or next(net.hosts()))) # type: ignore
    return IPv6Interface(f"{addr}/{net.prefixlen}")


@cache
def _lease() -> str:
    lease = Path(environ["PATH_DHCLIENT_DB"])
    try:
        return lease.read_text()
    except FileNotFoundError:
        return ""


def _wan_pd(token: IPv6Address) -> tuple[IPv6Interface, _LifeTime, _LifeTime] | None:
    if not (matches := tuple(_PREFIX.finditer(_lease()))):
        return None
    else:
        *_, match = matches
        net = match.group("network")
        lifetimes = match.group("lifetimes")

        network = IPv6Network(net)
        interface = _interface(network, token=token)

        now = int(time())
        timestamp = int(m.group(1)) if (m := _TIMESTAMP.search(lifetimes)) else now
        delta = min(0, timestamp - now)

        valid_lft: _LifeTime = (
            max(1, int(m.group(1)) + delta)
            if (m := _VALID.search(lifetimes))
            else "forever"
        )
        preferred_lft: _LifeTime = (
            max(1, int(m.group(1)) + delta)
            if (m := _PREFERRED.search(lifetimes))
            else "forever"
        )

        return interface, valid_lft, preferred_lft


def _dns() -> Iterator[IPv6Address]:
    if matches := tuple(_DNS.finditer(_lease())):
        *_, match = matches
        for addr in match.group(1).split(","):
            yield IPv6Address(addr)


def _run(*argv: str | PurePath) -> None:
    print(argv, file=stderr)
    check_call(argv)


def _replace(
    ifname: str,
    iface: IPv6Interface,
    valid: _LifeTime,
    preferred: _LifeTime,
) -> None:
    _run(
        "ip",
        "addr",
        "replace",
        str(iface),
        "dev",
        ifname,
        "valid_lft",
        str(valid),
        "preferred_lft",
        str(preferred),
    )


def _conf(token: IPv6Address, wan_if: str, lan_ifs: Iterable[str]) -> None:
    if pd := _wan_pd(token):
        new_prefix = 64
        iface, valid_lft, preferred_lft = pd
        network = iface.network
        _replace(
            ifname=wan_if,
            iface=iface,
            valid=valid_lft,
            preferred=preferred_lft,
        )

        if network.prefixlen <= new_prefix:
            subnets = zip(
                map(_interface, network.subnets(new_prefix=new_prefix)), lan_ifs
            )
            for iface, ifname in subnets:
                _replace(
                    ifname=ifname,
                    iface=iface,
                    valid=valid_lft,
                    preferred=preferred_lft,
                )

    _ = map(str, _dns())


def main() -> None:
    token = IPv6Address(environ["TOKEN"])
    wan_if = environ["WAN_IF"]
    lan_ifs = environ["LAN_IFS"].split(" ")
    _conf(token, wan_if=wan_if, lan_ifs=lan_ifs)
    check_call(("systemd-notify", "--status", "WATCHDOG=1"))


main()
