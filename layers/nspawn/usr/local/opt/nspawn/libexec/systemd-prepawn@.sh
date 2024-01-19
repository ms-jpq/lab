#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

ROOT="$1"
FS_ROOT="$ROOT/fs"
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

if ! [[ -d "$FS_ROOT" ]]; then
  mkdir -v -p -- "$FS_ROOT"
fi

cp -v -f -- ~/.ssh/authorized_keys "$FS_ROOT/root/.ssh/authorized_keys"
chroot "$FS_ROOT" ssh-keygen -A
