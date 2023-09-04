#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

MOUNT="$1"
NAME="$("${0%/*}/findfs.sh" "$MOUNT")"
zfs mount -- "$NAME"
