#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

NETWORK="$1"
DISABLE="$2"

if [[ -f "$NETWORK" ]]; then
  ENABLED="$(awk '/^DHCPServer/ { print $3 }' <"$NETWORK")"
  if [[ "$ENABLED" != 'no' ]]; then
    envsubst <"${0%/*}/../nodhcp.conf" | sponge -- "$DISABLE"
  fi
fi
