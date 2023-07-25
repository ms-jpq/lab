#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

cd -- "${0%/*}/.."

IFACE="$1"
DOMAIN="$2"

export -- IFACE DOMAIN IPV4_IF IPV6_IF IPV4_ADDR IPV6_ADDR

IPV4_IF="$(<"/run/ipv4/alloc/$IFACE")"
IPV4_ADDR="${IPV4_IF%%/*}"
IPV6_ADDR="$(./ula.sh "$IFACE")::1"
IPV6_IF="$IPV6_ADDR/64"

envsubst2.sh './@.network' "/run/systemd/network/0-$IFACE.network"
networkctl reload
networkctl reconfigure -- "$IFACE"
