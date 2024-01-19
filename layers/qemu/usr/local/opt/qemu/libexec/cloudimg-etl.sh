#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

SRC="$1"
DST="$2"
DIR="${DST%/*}"
BASE="${0%/*}"
DEALLOC="$BASE/fs-dealloc.sh"
LIB='/var/lib/local/qemu'

# DIE=(
#   cloud-init
#   rsyslog
#   snapd
# )

if ! [[ -v UNDER ]]; then
  "$DEALLOC" "$DST"
  if ! UNDER=1 "$0" "$@"; then
    "$DEALLOC" "$DST"
    exit 1
  else
    exit 0
  fi
fi

ZFS=''
FS="$(stat --file-system --format %T -- "$LIB")"
case "$FS" in
zfs)
  SOURCE="$(findmnt --noheadings --output source --target "$LIB")"
  NAME="${DIR##*/}"
  ZFS="$SOURCE/$NAME"
  zfs create -s -V 10G -- "$ZFS"
  ln -v -sf -- "/dev/zvol/$ZFS" "$DST"
  ;;
btrfs)
  btrfs subvolume create -- "$DIR"
  ;;
*)
  mkdir -v -p -- "$DIR"
  ;;
esac

qemu-img convert -f qcow2 -O raw -- "$SRC" "$DST"

if [[ -n "$ZFS" ]]; then
  zfs snapshot -- "$ZFS@-"
fi
