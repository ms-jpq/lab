#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

LIB="$1"
CACHE="$2"
MACHINE="$3"
ROOT="$4"
FS_ROOT="$ROOT/fs"
RSSH="$FS_ROOT/root/.ssh"
USRN="$FS_ROOT/usr/local/lib/systemd/network"
HR='/usr/local/libexec/hr-run.sh'

for BIN in "${0%/*}/../apriori.d"/*; do
  if [[ -x "$BIN" ]]; then
    "$BIN" "$MACHINE" "$ROOT"
  fi
done

if ! [[ -d "$ROOT" ]]; then
  FS="$(stat --file-system --format %T -- "$LIB")"
  "$HR" rm -v -fr -- "$ROOT"
  "$HR" gmake --directory /usr/local/opt/initd -- nspawn.pull

  case "$FS" in
  zfs)
    SOURCE="$(findmnt --noheadings --output source --target "$LIB" | tail --lines 1)"
    SOURCE="${SOURCE//[[:space:]]/''}"
    ZFS="$SOURCE/$MACHINE"
    UNIT="2-nspawnd@$MACHINE.service"
    "$HR" zfs create -o canmount=noauto -o mountpoint="$ROOT" -o org.openzfs.systemd:required-by="$UNIT" -o org.openzfs.systemd:before="$UNIT" -- "$ZFS"
    "$HR" zfs mount -- "$ZFS"
    ;;
  btrfs)
    "$HR" btrfs subvolume create -- "$ROOT"
    ;;
  *) ;;
  esac

  "$HR" mkdir -v -p -- "$FS_ROOT"
  "$HR" tar --extract --directory "$FS_ROOT" --file "$CACHE/cloudimg.tar.xz"
fi

"$HR" rm -v -rf -- "$FS_ROOT/etc/hostname"
"$HR" mkdir -v -p -- "$RSSH" "$USRN"
"$HR" cp -v -f -- /root/.ssh/authorized_keys "$RSSH/authorized_keys"
"$HR" cp -v -f -- "${0%/*}/../macvlan.network" "$USRN/10-macvlan.network"
"$HR" chroot "$FS_ROOT" ssh-keygen -A
"$HR" chroot "$FS_ROOT" dpkg --purge --force-all -- snapd cloud-init lxd-agent-loader
