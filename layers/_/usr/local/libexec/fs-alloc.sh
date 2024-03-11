#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

ROOT="$(realpath -- "$1")"
LIB="${ROOT%/*}"

FS="$(stat --file-system --format %T -- "$LIB")"

case "$FS" in
zfs)
  SOURCE="$(findmnt --noheadings --output source --target "$LIB")"
  NAME="${ROOT##"$LIB"/}"
  /usr/local/libexec/hr-run.sh zfs create -o mountpoint="$ROOT" -- "$SOURCE/$NAME"
  ;;
btrfs)
  /usr/local/libexec/hr-run.sh btrfs subvolume create -- "$ROOT"
  ;;
*)
  /usr/local/libexec/hr-run.sh mkdir -v -p -- "$ROOT"
  ;;
esac
