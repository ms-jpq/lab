#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail
shopt -u failglob

RUN="$1"
WANTS="$RUN/remote-fs.target.wants"

# shellcheck disable=SC1091
source -- /usr/local/etc/default/nfs.env

# shellcheck disable=SC2154
readarray -t -d ',' -- MOUNTS <<< "$NFS_MNTS"

mkdir -v -p -- "$WANTS"
for MOUNT in "${MOUNTS[@]}"; do
  MOUNT="${MOUNT//[[:space:]]/''}"
  if [[ -z $MOUNT ]]; then
    continue
  fi
  NFS_SERVER="${MOUNT%%':'*}"
  DIR="$(systemd-escape -- "${MOUNT#*':/'}")"
  MNT="$RUN/$DIR.mount"
  AUTO="$DIR.automount"
  NFS_SERVER="$NFS_SERVER" envsubst < /usr/local/opt/mount/nfs@.mount > "$MNT"
  cp -v -f -- /usr/local/opt/mount/@.automount "$RUN/$AUTO"
  chmod g+r,o+r -- "$MNT" "$RUN/$AUTO"
  ln -v -snf -- "../$AUTO" "$WANTS/$AUTO"
done
