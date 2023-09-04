#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

MACHINE="$1"
FS_ROOT="$2"
ROOT="$3"
CACHE="$4"

HR='/usr/local/libexec/hr-run.sh'
CONF='/usr/local/opt/nspawn/conf.d'
cat -- "$CONF"/*.nspawn | envsubst | sponge -- "/run/systemd/nspawn/$MACHINE.nspawn"

/usr/local/opt/zfs/libexec/mount-by-path.sh "$ROOT" || true

if ! [[ -d "$ROOT" ]]; then
  "$HR" rm -v -fr -- "$ROOT"
  "$HR" gmake --directory /usr/local/opt/initd -- nspawn.pull

  FS="$(stat --file-system --format %T -- "$FS_ROOT")"
  case "$FS" in
  zfs)
    SOURCE="$(findmnt --noheadings --output source --target "$FS_ROOT" | tail --lines 1)"
    SOURCE="${SOURCE//[[:space:]]/''}"
    ZFS="$SOURCE/$MACHINE"
    UNIT="2-nspawnd@$MACHINE.service"
    "$HR" zfs create -o canmount=noauto -o mountpoint="$ROOT" -o org.openzfs.systemd:required-by="$UNIT" -o org.openzfs.systemd:before="$UNIT" -- "$ZFS"
    "$HR" zfs mount -- "$ZFS"
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
USRN="$ROOT/usr/local/lib/systemd/network"
"$HR" rm -v -rf -- "$ROOT/etc/hostname"
"$HR" mkdir -v -p -- "$RSSH" "$USRN"
"$HR" cp -v -f -- /root/.ssh/authorized_keys "$RSSH/authorized_keys"
"$HR" cp -v -f -- "${0%/*}/../macvlan.network" "$USRN/10-macvlan.network"
"$HR" chroot "$ROOT" ssh-keygen -A
"$HR" chroot "$ROOT" dpkg --purge --force-all -- snapd cloud-init lxd-agent-loader
