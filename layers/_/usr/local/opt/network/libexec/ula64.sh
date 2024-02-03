#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

ID="$(</etc/machine-id)"
ULA=$((0xfd << 56))
B3="$(b3sum --no-names --length 6 <<<"$ID")"
MASK=$((~(0xffff << 48)))
printf -v BITS -- '%08x' $(((ULA ^ "0x$B3" << 8) >> 16 & MASK))
exec -- perl -CASD -wpe 's/(.{4})(?=.)/$1:/g' <<<"$BITS"
