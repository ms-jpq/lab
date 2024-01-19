#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

SRC="$1"
DST="$2"
ROOT="$3"
NAME="$4"

HR='/usr/local/libexec/hr-run.sh'
SFS="$(stat --file-system --format %T -- "$SRC")"
DFS="$(stat --file-system --format %T -- "$DST")"

case "$SFS-$DFS" in
zfs-zfs)
  SOURCE="$(findmnt --noheadings --output source --target "$DST" | tail --lines 1)"
  SOURCE="${SOURCE//[[:space:]]/''}"
  "$HR" zfs create -o mountpoint="$ROOT" -- "$SOURCE/$NAME"
  ;;
btrfs-btrfs)
  "$HR" btrfs subvolume create -- "$ROOT"
  ;;
*)
  "$HR" cp -a -- "$SRC" "$ROOT"
  ;;
esac
