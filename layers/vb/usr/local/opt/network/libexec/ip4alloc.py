#!/usr/bin/env -S -- PYTHONSAFEPATH= python3

from argparse import ArgumentParser, Namespace
from collections.abc import Iterable, Iterator, Sequence
from functools import reduce
from ipaddress import IPv4Interface, IPv4Network, collapse_addresses
from os import linesep
from sys import exit, stderr, stdout


def _sort(networks: Iterable[IPv4Network]) -> Sequence[IPv4Network]:
    return sorted(
        collapse_addresses(networks),
        key=lambda n: (n.num_addresses, n.broadcast_address),
    )


def _rm(networks: Iterable[IPv4Network], net: IPv4Network) -> Iterator[IPv4Network]:
    def cont() -> Iterator[IPv4Network]:
        for network in _sort(networks):
            if network.supernet_of(net):
                yield from network.address_exclude(net)
            elif network.overlaps(net) or net.overlaps(network):
                pass
            else:
                yield network

    return collapse_addresses(cont())


def _rm_r(
    reservoir: Iterable[IPv4Network], drain: Iterable[IPv4Interface]
) -> Sequence[IPv4Network]:
    sink = _sort(iface.network for iface in drain)
    it = reduce(_rm, sink, reservoir)
    return _sort(it)


def _split(
    network: IPv4Network, prefix: int
) -> tuple[IPv4Network | None, Iterator[IPv4Network]]:
    if network.prefixlen > prefix or network.max_prefixlen < prefix:
        return None, iter((network,))
    for net in network.subnets(new_prefix=prefix):
        return net, network.address_exclude(net)
    else:
        assert False


def _splits(
    networks: Iterable[IPv4Network], prefixes: Sequence[int]
) -> tuple[Sequence[IPv4Network], Sequence[IPv4Network]]:
    reservoir = _sort(networks)

    def cont() -> Iterator[IPv4Network]:
        nonlocal reservoir

        acc = list[IPv4Network]()
        seen = set[IPv4Network]()

        for prefix in sorted(prefixes):
            found = False
            for network in reservoir:
                if found:
                    acc.append(network)
                else:
                    net, free = _split(network, prefix)
                    acc.extend(free)
                    if net:
                        seen.add(net)
                        found = True
                        yield net

            reservoir = _sort(acc)
            acc = []

    return _sort(cont()), reservoir


def _parse_args() -> Namespace:
    parser = ArgumentParser()
    parser.add_argument("-v", "--verbose", action="store_true")
    parser.add_argument(
        "--reservoir",
        type=IPv4Network,
        nargs="+",
        default=(
            IPv4Network("192.168.0.0/16"),
            IPv4Network("172.16.0.0/12"),
            IPv4Network("10.0.0.0/8"),
        ),
    )
    parser.add_argument("--no", type=IPv4Interface, nargs="*", default=())
    parser.add_argument("split", type=int, nargs="+")
    return parser.parse_args()


def main() -> None:
    args = _parse_args()
    free = _rm_r(args.reservoir, drain=args.no)
    networks, leftover = _splits(free, prefixes=args.split)

    for net in networks:
        iface = IPv4Interface(f"{next(net.hosts())}/{net.prefixlen}") # type: ignore
        stdout.writelines((iface.exploded, linesep))

    if args.verbose:
        for net in leftover:
            stderr.writelines(("# ", net.exploded, linesep))

    if len(networks) != len(args.split):
        exit(1)


main()
