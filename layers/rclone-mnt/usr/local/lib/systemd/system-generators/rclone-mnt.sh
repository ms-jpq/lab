#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O globstar

set -o pipefail

RUN="$1"
WANTS="$RUN/remote-fs.target.wants"

mkdir -p -- "$WANTS"
for ENV in /usr/local/etc/default/*.rmount.env; do
  BASE="${ENV##*/}"
  STEM="${BASE%".rmount.env"}"
  NAME=$(systemd-escape -- "$STEM")
  ln -snf -- /usr/local/lib/systemd/system/1-rclone-mnt@.service "$WANTS/1-rclone-mnt@$NAME.service"
done
