#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

if ! [[ -v INVOCATION_ID ]]; then
  UNIT="${0##*/}"
  UNIT="${UNIT%.sh}"
  SVC="$UNIT.service"
  if systemctl list-units --all --output json -- "$SVC" | jq --exit-status 'any(.sub == "start" or .sub == "running")' > /dev/null; then
    exec -- journalctl --boot --follow --unit "$SVC"
  else
    exec -- systemd-run --service-type oneshot --no-block --unit "$UNIT" -- "$0" "$@"
  fi
fi

SRC="/media/${1:-"downloads/done"}"
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
chown -v --recursive -- 1000:1000 "$DST"
