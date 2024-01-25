#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

PROXY_CONF="${0%/*}/../proxychains4.conf"

if ! [[ -f "$PROXY_CONF" ]]; then
  exec -- "$@"
else
  exec -- proxychains -f "$PROXY_CONF" "$@"
fi
