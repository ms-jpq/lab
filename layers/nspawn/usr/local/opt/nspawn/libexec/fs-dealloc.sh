#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

ROOT="$1"
HR='/usr/local/libexec/hr-run.sh'

FS="$(stat --file-system --format %T -- "$ROOT")"
case "$FS" in
zfs)
  SOURCE="$(findmnt --noheadings --output source --target "$ROOT")"
  "$HR" zfs destroy -v -r -- "$SOURCE"
  ;;
btrfs)
  "$HR" btrfs subvolume delete -- "$ROOT"
  ;;
*) ;;
esac
"$HR" rm -v -fr -- "$ROOT"
