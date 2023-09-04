#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

MOUNT="$1"
Z="$(zfs list -H -o name,mountpoint)"
readarray -t -- ZFS <<<"$Z"

for Z in "${ZFS[@]}"; do
  NAME="${Z%%$'\t'*}"
  MOUNTPOINT="${Z#*$'\t'}"
  if [[ "$MOUNTPOINT" == "$MOUNT" ]]; then
    printf -- '%s' "$NAME"
    exit
  fi
done
exit 1
