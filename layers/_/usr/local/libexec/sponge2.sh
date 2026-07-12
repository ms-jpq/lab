#!/usr/bin/env -S -- bash -Eeuo pipefail -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

DST="$1"
shift -- 1

mkdir -v --parents -- "${DST%/*}"
"$@" | sponge -- "$DST"
