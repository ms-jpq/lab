#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

CACHE="$1"
ROOT="$2"
FS_ROOT="$ROOT/fs"
RSSH="$FS_ROOT/root/.ssh"
USRN="$FS_ROOT/usr/local/lib/systemd/network"

if ! [[ -d "$FS_ROOT" ]]; then
  mkdir -v -p -- "$FS_ROOT"
  tar --extract --directory "$FS_ROOT" --file "$CACHE/cloudimg.tar.xz"
fi

BANNED=(
  cloud-init
  lxd-agent-loader
  rsyslog
  snapd
)

rm -v -rf -- "$FS_ROOT/etc/hostname"
mkdir -v -p -- "$RSSH" "$USRN"
cp -v -f -- ~/.ssh/authorized_keys "$RSSH/authorized_keys"
cp -v -f -- "${0%/*}/../macvlan.network" "$USRN/10-macvlan.network"
chroot "$FS_ROOT" ssh-keygen -A
chroot "$FS_ROOT" dpkg --purge --force-all -- "${BANNED[@]}"
