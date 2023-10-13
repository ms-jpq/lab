#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

MARKS=(0xb00b0069 0x69)
TABLE=100

ip route add local default dev lo table "$TABLE"
ip -6 route add local default dev lo table "$TABLE"

for MARK in "${MARKS[@]}"; do
  ip rule add fwmark "$MARK" lookup "$TABLE"
  ip -6 rule add fwmark "$MARK" lookup "$TABLE"
done
