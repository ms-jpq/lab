#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

SRC="$1"
DST="$2"
ROOTFS='raw'
ROOT="$DST/$ROOTFS"
SIZE='88G'

FS="$(stat --file-system --format %T -- "$DST")"
case "$FS" in
zfs)
  DESTINATION="$(findmnt --noheadings --output source --target "$DST")"
  NAME="$DESTINATION/$ROOTFS"
  if [[ -n "$SRC" ]]; then
    SOURCE="$(findmnt --noheadings --output source --target "$SRC")"
    LATEST="$(zfs list -t snapshot -H -o name -- "$SOURCE" | tail --lines 1)"
    zfs clone -- "$LATEST" "$NAME"
  else
    zfs create -s -V "$SIZE" -- "$NAME"
  fi
  ln -v -sf -- "/dev/zvol/$NAME" "$ROOT"
  udevadm trigger
  ;;
btrfs)
  # TODO
  exit 69
  ;;
*)
  if [[ -n "$SRC" ]]; then
    cp -v -f --reflink=auto -- "$SRC" "$ROOT"
    qemu-img resize -f raw -- "$ROOT" +"$SIZE"
  else
    qemu-img create -f raw -- "$ROOT" "$SIZE"
  fi
  ;;
esac
