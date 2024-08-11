#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

NETDEV="$*"
if CONF="$(wg showconf "$NETDEV" | sed -E -e '/^ListenPort/d')"; then
  wg syncconf "$NETDEV" /dev/fd/0 <<< "$CONF"
fi
