#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

ROOT="$1"
DRIVE="$2"
RAW="$3"

NAME="$(/usr/local/opt/zfs/libexec/findfs.sh fs "$ROOT")/raw"
ZVOL="/dev/zvol/$NAME"

/usr/local/libexec/hr-run.sh zfs create -s -V 88G -- "$NAME"
/usr/local/libexec/hr-run.sh ln -v -sf -- "$ZVOL" "$DRIVE"
/usr/local/libexec/hr-run.sh udevadm trigger
if [[ -n "$RAW" ]]; then
  cat -- "$RAW" >"$ZVOL"
fi
