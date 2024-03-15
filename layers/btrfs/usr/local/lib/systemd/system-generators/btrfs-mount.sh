#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O globstar

set -o pipefail

RUN="$1"
WANTS="$RUN/multi-user.target.wants"

# shellcheck disable=SC1091
source -- /usr/local/etc/default/btrfs.env

# shellcheck disable=SC2154
readarray -t -d ',' -- MOUNTS <<<"$BTRFS_MNTS"

mkdir -v -p -- "$WANTS"
for MOUNT in "${MOUNTS[@]}"; do
  MOUNT="${MOUNT//[[:space:]]/''}"
  LABEL="${MOUNT%%':'*}"
  DIR="$(systemd-escape -- "${MOUNT#*':/'}")"
  MNT="$RUN/$DIR.mount"
  AUTO="$RUN/$DIR.automount"
  LABEL="$LABEL" envsubst </usr/local/opt/mount/btrfs@.mount >"$MNT"
  cp -v -f -- /usr/local/opt/mount/@.automount "$AUTO"
  chmod g+r,o+r -- "$MNT" "$AUTO"
  ln -v -sf -- "../$AUTO" "$WANTS/$AUTO"
done
