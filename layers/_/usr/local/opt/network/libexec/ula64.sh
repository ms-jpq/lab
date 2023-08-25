#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

IFACE="$1"
ID="$(</etc/machine-id)+$IFACE"
SHIFT=56
ULA=$((0xfd << SHIFT))
B2="$(b2sum --binary --length "$SHIFT" <<<"$ID")"
B2="${B2% *}"
printf -v BITS -- '%x' $((ULA ^ "0x$B2"))
exec -- perl -CASD -wpe 's/(.{4})(?=.)/\1:/g' <<<"$BITS"
