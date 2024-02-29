#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O globstar

set -o pipefail

RUN="$1"
WANTS="$RUN/multi-user.target.wants"

mkdir -v -p -- "$WANTS"
for MOUNT in /usr/local/lib/systemd/system/*.mount; do
  NAME="${MOUNT##*/}"
  NAME="${NAME%.mount}"
  AUTO="$NAME.automount"
  cp -v -f -- /usr/local/opt/mount/@.automount "$RUN/$AUTO"
  chmod g+r,o+r -- "$RUN/$AUTO"
  ln -v -sf -- "../$AUTO" "$WANTS/$AUTO"
done
