#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

NAME="$1"
MACHINE="$2"
FS_ROOT="$3"
ROOT="$4"
CACHE="$5"

HR='/usr/local/libexec/hr-run.sh'
CONF='/usr/local/opt/nspawn/conf.d'
cat -- "$CONF"/*.nspawn | envsubst | sponge -- "/run/systemd/nspawn/$MACHINE.nspawn"

if ! [[ -d "$ROOT" ]]; then
  "$HR" rm -v -fr -- "$ROOT"
  "$HR" gmake --directory /usr/local/opt/initd -- nspawn.pull

  FS="$(stat --file-system --format %T -- "$FS_ROOT")"
  case "$FS" in
  zfs)
    SOURCE="$(findmnt --noheadings --output source --target "$FS_ROOT" | tail --lines 1)"
    SOURCE="${SOURCE//[[:space:]]/''}"
    ZFS="$SOURCE/$NAME"
    "$HR" zfs create -o mountpoint="$ROOT" -- "$ZFS"
    ;;
  btrfs)
    "$HR" btrfs subvolume create -- "$ROOT"
    ;;
  *)
    "$HR" mkdir -v -p -- "$ROOT"
    ;;
  esac

  "$HR" tar --extract --directory "$ROOT" --file "$CACHE/cloudimg.tar.xz"
fi

RSSH="$ROOT/root/.ssh"
"$HR" mkdir -v -p -- "$RSSH"
"$HR" cp -v -f -- /root/.ssh/authorized_keys "$RSSH/authorized_keys"
"$HR" chroot "$ROOT" ssh-keygen -A
"$HR" chroot "$ROOT" dpkg --purge --force-all -- snapd cloud-init lxd-agent-loader
