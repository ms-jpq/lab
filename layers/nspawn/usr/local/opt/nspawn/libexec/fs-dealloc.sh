#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

ROOT="$1"
HR='/usr/local/libexec/hr-run.sh'

if ! [[ -e "$ROOT" ]]; then
  exit 0
fi

FS="$(stat --file-system --format %T -- "$ROOT")"
case "$FS" in
tmpfs)
  ZVOl="$(readlink -- "$ROOT")"
  ZVOL="${ZVOl#/dev/zvol/}"
  "$HR" zfs destroy -v -r -- "$ZVOL"
  ;;
zfs)
  ZFS="$(findmnt --noheadings --output source --target "$ROOT")"
  "$HR" zfs destroy -v -r -- "$ZFS"
  ;;
btrfs)
  "$HR" btrfs subvolume delete -- "$ROOT"
  ;;
*) ;;
esac
"$HR" rm -v -fr -- "$ROOT"
