#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

MACHINE="$1"
ROOT="$2"
CACHE="$3"

CONF='/usr/local/opt/nspawn/conf.d'
cat -- "$CONF"/*.nspawn | envsubst | sponge -- "/run/systemd/nspawn/$MACHINE.nspawn"

if ! [[ -d "$ROOT" ]]; then
  rm -v -fr -- "$ROOT"
  gmake --directory /usr/local/opt/initd -- nspawn
  mkdir -p -- "$ROOT"
  tar --extract --directory "$ROOT" --file "$CACHE/cloudimg.tar.xz"
fi

RSSH="$ROOT/root/.ssh"
mkdir -v -p -- "$RSSH"
cp -v -f -- /root/.ssh/authorized_keys "$RSSH/authorized_keys"
chroot "$ROOT" ssh-keygen -A
chroot "$ROOT" dpkg --purge --force-all -- snapd cloud-init lxd-agent-loader
