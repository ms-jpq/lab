#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

LIB="$1"
ROOT="$2"

FS="$(stat --file-system --format %T -- "$LIB")"
case "$FS" in
zfs)
  if SOURCE="$(/usr/local/opt/zfs/libexec/findfs.sh fs "$ROOT")"; then
    /usr/local/libexec/hr-run.sh zfs destroy -v -r -- "$SOURCE"
  fi
  ;;
btrfs)
  /usr/local/libexec/hr-run.sh btrfs subvolume delete -- "$ROOT"
  ;;
*) ;;
esac
/usr/local/libexec/hr-run.sh rm -v -fr -- "$ROOT"
