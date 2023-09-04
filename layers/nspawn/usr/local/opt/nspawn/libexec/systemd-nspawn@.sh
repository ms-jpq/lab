#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

MACHINE="$1"
ROOT="$2"

ZFS='/usr/local/opt/zfs/libexec/mount.sh'
if [[ -x "$ZFS" ]]; then
  "$ZFS" "$ROOT" || true
fi

exec -- systemd-nspawn --keep-unit --boot --notify-read=yes -U --network-veth --link-journal=try-guest --settings=override --machine="$MACHINE" --directory="$ROOT"
