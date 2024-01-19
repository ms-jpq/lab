#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

B2="$(b2sum --binary --length 64 -- "$@")"
B2="${B2% *}"
exec -- perl -CASD -wpe 's/(.{4})(?=.)/$1:/g' <<<"$B2"
