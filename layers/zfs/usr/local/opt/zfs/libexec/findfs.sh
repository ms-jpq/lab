#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

TYPE="$1"
MOUNT="$2"

case "$TYPE" in
fs)
  Z="$(zfs list -H -o name,mountpoint -t filesystem)"
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
  ;;
vol)
  if [[ "$MOUNT" != /dev/zvol/* ]] && [[ -L "$MOUNT" ]]; then
    MOUNT="$(readlink -- "$MOUNT")"
  fi
  Z="$(zfs list -H -o name -t volume)"
  readarray -t -- ZFS <<<"$Z"
  for Z in "${ZFS[@]}"; do
    ALIAS="/dev/zvol/$Z"
    if [[ "$ALIAS" == "$MOUNT" ]]; then
      printf -- '%s' "$Z"
      exit
    fi
  done
  exit 1
  ;;
*)
  exit 2
  ;;
esac
