#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

LIB="$1"
MACHINE="$2"
ROOT="$3"
DRIVE="$4"
RAW='/var/cache/local/qemu/cloudimg.raw'
HR='/usr/local/libexec/hr-run.sh'

for BIN in "${0%/*}/../apriori.d"/*; do
  if [[ -x "$BIN" ]]; then
    "$BIN" "$MACHINE" "$ROOT" "$DRIVE"
  fi
done

if ! [[ -d "$ROOT" ]]; then
  FS="$(stat --file-system --format %T -- "$LIB")"
  "$HR" rm -v -fr -- "$ROOT"
  "$HR" gmake --directory /usr/local/opt/initd -- qemu.pull

  case "$FS" in
  zfs)
    SOURCE="$(findmnt --noheadings --output source --target "$LIB" | tail --lines 1)"
    SOURCE="${SOURCE//[[:space:]]/''}"
    ZFS="$SOURCE/$MACHINE"
    ZFSFS="$ZFS/fs"
    UNIT="2-qemu-microvm@$MACHINE.service"
    "$HR" zfs create -o canmount=noauto -o mountpoint="$ROOT" -o org.openzfs.systemd:required-by="$UNIT" -o org.openzfs.systemd:before="$UNIT" -- "$ZFS"
    "$HR" zfs mount -- "$ZFS"
    "$HR" zfs create -s -V 100G "$ZFSFS"
    "$HR" ln -v -sf "/dev/zvol/$ZFSFS" "$DRIVE"
    "$HR" systemctl daemon-reload
    "$HR" cat -- "$RAW" >"$DRIVE"
    ;;
  btrfs)
    "$HR" btrfs subvolume create -- "$ROOT"
    "$HR" cp -v -f --reflink=auto -- "$RAW" "$DRIVE"
    ;;
  *)
    "$HR" mkdir -v -p -- "$ROOT"
    "$HR" cp -v -f --reflink=auto -- "$RAW" "$DRIVE"
    ;;
  esac
fi
