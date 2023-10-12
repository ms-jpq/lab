#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

MARK=0xb00b0069
TABLE=100

ip rule add fwmark "$MARK" lookup "$TABLE"
ip route add local default dev lo table "$TABLE"
ip -6 rule add fwmark "$MARK" lookup "$TABLE"
ip -6 route add local default dev lo table "$TABLE"
