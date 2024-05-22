#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

MACHINE="$1"
DNSMAQ_CONF="$2"
HOSTS="$3"
DOMAIN="$4"

LO64="$(/usr/local/opt/network/libexec/ip64alloc.sh <<< "$MACHINE")"
# shellcheck disable=2154
IPV6="$IPV6_NETWORK:$LO64"

cp -v -- "${0%/*}/../dhcp.conf" "$DNSMAQ_CONF/dhcp.conf"

sponge -- "$HOSTS/qemu" <<- EOF
$IPV6 _qemu.$DOMAIN
EOF
