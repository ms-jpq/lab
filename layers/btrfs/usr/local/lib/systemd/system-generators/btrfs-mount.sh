#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail
shopt -u failglob

RUN="$1"
WANTS="$RUN/local-fs.target.wants"

# shellcheck disable=SC1091
source -- /usr/local/etc/default/btrfs.env

# shellcheck disable=SC2154
readarray -t -d ',' -- MOUNTS <<< "$BTRFS_MNTS"

mkdir -v -p -- "$WANTS"
for MOUNT in "${MOUNTS[@]}"; do
  MOUNT="${MOUNT//[[:space:]]/''}"
  LABEL="${MOUNT%%':'*}"
  DIR="$(systemd-escape -- "${MOUNT#*':/'}")"
  MNT="$RUN/$DIR.mount"
  AUTO="$DIR.automount"
  LABEL="$LABEL" envsubst < /usr/local/opt/mount/btrfs@.mount > "$MNT"
  cp -v -f -- /usr/local/opt/mount/@.automount "$RUN/$AUTO"
  chmod g+r,o+r -- "$MNT" "$RUN/$AUTO"
  ln -v -snf -- "../$AUTO" "$WANTS/$AUTO"
done
