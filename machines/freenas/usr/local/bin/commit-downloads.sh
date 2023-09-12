#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

SRC="/media/${1:-"downloads"}"
DST='/media/media/_tmp_/'

RSYNC=(
  rsync
  --mkpath
  --recursive
  --links
  --perms
  --times
  --human-readable
  --info progress2
  -- "$SRC" "$DST"
)

"${RSYNC[@]}"
chown -v --recursive -- ubuntu:ubuntu "$DST"
