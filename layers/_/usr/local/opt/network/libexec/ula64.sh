#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

ID="$(</etc/machine-id)"
ULA=$((0xfd << 56))
B2="$(b2sum --binary --length 48 <<<"$ID")"
B2="${B2% *}"
MASK=$((~(0xffff << 48)))
printf -v BITS -- '%x' $(((ULA ^ "0x$B2" << 16) >> 16 & MASK))
exec -- perl -CASD -wpe 's/(.{4})(?=.)/$1:/g' <<<"$BITS"
