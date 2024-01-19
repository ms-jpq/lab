#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

SRC="$1"
DST="$2"
ROOTFS='fs'
ROOT="$DST/$ROOTFS"

FS="$(stat --file-system --format %T -- "$DST")"
case "$FS" in
zfs)
  SOURCE="$(findmnt --noheadings --output source --target "$SRC")"
  DESTINATION="$(findmnt --noheadings --output source --target "$DST")"
  LATEST="$(zfs list -t snapshot -H -o name -- "$SOURCE" | tail --lines 1)"
  NAME="$DESTINATION/$ROOTFS"
  zfs clone -o mountpoint="$ROOT" -- "$LATEST" "$NAME"
  ;;
btrfs)
  btrfs subvolume snapshot -- "$SRC" "$ROOT"
  ;;
*)
  cp -v -a -f --reflink=auto -- "$SRC" "$ROOT"
  ;;
esac

cp -v -f -- ~/.ssh/authorized_keys "$ROOT/root/.ssh/authorized_keys"
chroot "$ROOT" ssh-keygen -A
