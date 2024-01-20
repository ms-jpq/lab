#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

SRC="$1"
DST="$2"
DIR="${DST%/*}"
BASE="${0%/*}"
DEALLOC="$BASE/fs-dealloc.sh"
LIB='/var/lib/local/qemu'

DIE=(
  lxd-agent-loader
  rsyslog
  snapd
)

if ! [[ -v UNDER ]]; then
  "$DEALLOC" "$DST"
  rm -v -fr -- "$DIR"
  if ! UNDER=1 "$0" "$@"; then
    "$DEALLOC" "$DST"
    exit 1
  else
    exit 0
  fi
fi

ZVOL=''
FS="$(stat --file-system --format %T -- "$LIB")"
case "$FS" in
zfs)
  SOURCE="$(findmnt --noheadings --output source --target "$LIB")"
  NAME="${DIR##*/}"
  ZVOL="$SOURCE/$NAME"
  zfs create -s -V 10G -- "$ZVOL"
  mkdir -v -p -- "$DIR"
  ln -v -sf -- "/dev/zvol/$ZVOL" "$DST"
  udevadm trigger
  ;;
btrfs)
  btrfs subvolume create -- "$DIR"
  ;;
*)
  mkdir -v -p -- "$DIR"
  ;;
esac

qemu-img convert -f qcow2 -O raw -- "$SRC" "$DST"
systemd-nspawn --register no --as-pid2 --image "$DST" -- dpkg --purge --force-all -- "${DIE[@]}"

if [[ -n "$ZVOL" ]]; then
  zfs snapshot -- "$ZVOL@-"
fi