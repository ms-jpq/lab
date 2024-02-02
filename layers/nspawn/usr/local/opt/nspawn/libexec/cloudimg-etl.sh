#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

SRC="$1"
DST="$2"
BASE="${0%/*}"
DEALLOC="$BASE/fs-dealloc.sh"
LIB='/var/lib/local/nspawn'
USRN="$DST/usr/local/lib/systemd/network"

DIE=(
  cloud-init
  lxd-agent-loader
  rsyslog
  snapd
)

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
  NAME="${DST##*/}"
  ZFS="$SOURCE/$NAME"
  zfs create -o mountpoint="$DST" -- "$ZFS"
  ;;
btrfs)
  btrfs subvolume create -- "$DST"
  ;;
*)
  mkdir -v -p -- "$DST"
  ;;
esac

tar --extract --directory "$DST" --file "$SRC"
mkdir -v -p -- "$DST/root/.ssh" "$USRN"
rm -v -rf -- "$DST/etc/hostname"
chroot "$DST" dpkg --purge --force-all -- "${DIE[@]}"

for SCRIPT in "${0%/*}/../overlay.d"/*; do
  if [[ -x "$SCRIPT" ]]; then
    "$SCRIPT" "$DST"
  fi
done

if [[ -n "$ZFS" ]]; then
  zfs snapshot -- "$ZFS@-"
fi
