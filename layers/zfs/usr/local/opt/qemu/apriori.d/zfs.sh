#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

ROOT="$2"

if NAME="$(/usr/local/opt/zfs/libexec/findfs.sh vol "$ROOT")"; then
  exec -- zfs mount -- "$NAME"
fi
