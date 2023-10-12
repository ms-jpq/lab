#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

MARK=0x69
ip rule add fwmark "$MARK" lookup 100
ip route add local default dev lo table 100
ip -6 rule add fwmark "$MARK" lookup 100
ip -6 route add local default dev lo table 100
