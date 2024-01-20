#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail
set -x

SRC="$1"
DST="$2"
DIR="${DST%/*}"
RAW='raw'
ROOT="$DST/$RAW"
SIZE='88G'

FS="$(stat --file-system --format %T -- "$DIR")"
case "$FS" in
zfs)
  DESTINATION="$(findmnt --noheadings --output source --target "$DIR")"
  ZVOL="$DESTINATION/$RAW"
  mkdir -v -p -- "$DST"
  if [[ -n "$SRC" ]]; then
    SOURCE="$(readlink -- "$SRC")"
    SOURCE="${SOURCE#/dev/zvol/}"
    LATEST="$(zfs list -t snapshot -H -o name -- "$SOURCE" | tail --lines 1)"
    zfs clone -- "$LATEST" "$ZVOL"
  else
    zfs create -s -V "$SIZE" -- "$ZVOL"
  fi
  ln -v -sf -- "/dev/zvol/$ZVOL" "$ROOT"
  udevadm trigger
  ;;
btrfs)
  if [[ -n "$SRC" ]]; then
    btrfs subvolume snapshot -- "$SRC" "$ROOT"
    qemu-img resize -f raw -- "$ROOT" +"$SIZE"
  else
    btrfs subvolume create -- "$DST"
    qemu-img create -f raw -- "$ROOT" "$SIZE"
  fi
  ;;
*)
  if [[ -n "$SRC" ]]; then
    cp -v -a -f --reflink=auto -- "$SRC" "$DST"
    qemu-img resize -f raw -- "$ROOT" +"$SIZE"
  else
    mkdir -v -p -- "$DST"
    qemu-img create -f raw -- "$ROOT" "$SIZE"
  fi
  ;;
esac
