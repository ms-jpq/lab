#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

ROOT="$2"
/usr/local/opt/zfs/libexec/mount-by-path.sh "$ROOT"
