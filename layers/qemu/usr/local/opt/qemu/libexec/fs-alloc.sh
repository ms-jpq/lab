#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

UNIT="$1"
LIB="$2"
MACHINE="$3"
ROOT="$4"
HR='/usr/local/libexec/hr-run.sh'

"${0%/*}/apriori.sh" "$MACHINE" "$ROOT"

if ! [[ -d "$ROOT" ]]; then
  FS="$(stat --file-system --format %T -- "$LIB")"
  "$HR" rm -v -fr -- "$ROOT"
  "$HR" gmake --directory /usr/local/opt/initd -- qemu.pull

  case "$FS" in
  zfs)
    SOURCE="$(findmnt --noheadings --output source --target "$LIB" | tail --lines 1)"
    SOURCE="${SOURCE//[[:space:]]/''}"
    ZFS="$SOURCE/$MACHINE"
    "$HR" zfs create -o canmount=noauto -o mountpoint="$ROOT" -o org.openzfs.systemd:required-by="$UNIT" -o org.openzfs.systemd:before="$UNIT" -- "$ZFS"
    "$HR" zfs mount -- "$ZFS"
    ;;
  btrfs)
    "$HR" btrfs subvolume create -- "$ROOT"
    ;;
  *)
    "$HR" mkdir -v -p -- "$ROOT"
    ;;
  esac
fi
