#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

NETDEV="$1"
NETDEV_FILE="$2"

if CONF="$(wg showconf "$NETDEV" | sed -E -e '/^ListenPort/d' -e '/^Endpoint/d')"; then
  {
    printf -- '%s\n' "$CONF"
    sed -E -n -e '/^Endpoint/p' -- "$NETDEV_FILE"
  } | wg syncconf "$NETDEV" /dev/fd/0
fi
