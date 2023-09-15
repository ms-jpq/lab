#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail
set -x

if ! [[ -v INVOCATION_ID ]]; then
  UNIT="$(systemd-escape -- "${0##*/}")"
  exec -- systemd-run --service-type oneshot --remain-after-exit --no-block --unit "$UNIT" -- "$0" "$@"
fi

SRC="/media/${1:-"downloads"}"
DST='/media/media/_tmp_/'

RSYNC=(
  rsync
  --verbose
  --mkpath
  --recursive
  --links
  --perms
  --times
  --human-readable
  -- "$SRC/" "$DST"
)

"${RSYNC[@]}"
chown -v --recursive -- ubuntu:ubuntu "$DST"
