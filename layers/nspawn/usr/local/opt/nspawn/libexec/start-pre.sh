#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail
set -x

ROOT="$1"

FS="$(stat --file-system --format %T -- "$ROOT")"

case "$FS" in
zfs)
  Z="$(zfs list -H -o name,mountpoint)"
  readarray -t -- ZFS <<<"$Z"
  for Z in "${ZFS[@]}"; do
    NAME="${Z%%$'\t'*}"
    MOUNTPOINT="${Z#*$'\t'}"
    if [[ "$MOUNTPOINT" == "$ROOT" ]]; then
      systemd-mount -- "$NAME" "$MOUNTPOINT"
      break
    fi
  done
  ;;
*) ;;
esac
