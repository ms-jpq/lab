#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

MACHINE="$1"
HOSTS="$2"
DOMAIN="$3"

LO64="$(/usr/local/opt/network/libexec/ip64alloc.sh <<<"$MACHINE")"
# shellcheck disable=2154
IPV6="$IPV6_NETWORK:$LO64"

sponge -- "$HOSTS/qemu" <<-EOF
$IPV6 _qemu.$DOMAIN $MACHINE.$DOMAIN
EOF
