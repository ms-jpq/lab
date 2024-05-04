#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

PROTO=(-4 -6)
MARKS=(0xb00b0069)
TABLE=100

for P in "${PROTO[@]}"; do
  # ((TABLE++))
  ip "$P" route replace local default dev lo table "$TABLE"
  for MARK in "${MARKS[@]}"; do
    ip "$P" rule add fwmark "$MARK" lookup "$TABLE"
  done
done
