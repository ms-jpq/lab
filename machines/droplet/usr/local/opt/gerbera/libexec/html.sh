#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

HTML='/var/lib/gerbera/gerbera.html'
if [[ -f "$HTML" ]]; then
  exec -- sed -E -n -- 's/.+URL=([^"]+).+/\1/p' "$HTML"
fi
