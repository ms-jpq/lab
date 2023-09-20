#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

CACHE="$1"
ROOT="$2"
FS_ROOT="$ROOT/fs"
RSSH="$FS_ROOT/root/.ssh"
USRN="$FS_ROOT/usr/local/lib/systemd/network"
HR='/usr/local/libexec/hr-run.sh'

if ! [[ -d "$FS_ROOT" ]]; then
  "$HR" mkdir -v -p -- "$FS_ROOT"
  "$HR" tar --extract --directory "$FS_ROOT" --file "$CACHE/cloudimg.tar.xz"
fi

"$HR" rm -v -rf -- "$FS_ROOT/etc/hostname"
"$HR" mkdir -v -p -- "$RSSH" "$USRN"
"$HR" cp -v -f -- ~/.ssh/authorized_keys "$RSSH/authorized_keys"
"$HR" cp -v -f -- "${0%/*}/../macvlan.network" "$USRN/10-macvlan.network"
"$HR" chroot "$FS_ROOT" ssh-keygen -A
"$HR" chroot "$FS_ROOT" dpkg --purge --force-all -- snapd cloud-init lxd-agent-loader
