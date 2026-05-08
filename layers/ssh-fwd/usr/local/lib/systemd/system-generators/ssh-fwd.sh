#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O globstar

set -o pipefail

RUN="$1"
WANTS="$RUN/multi-user.target.wants"

mkdir -p -- "$WANTS"
for ENV in /usr/local/etc/default/*.sshfwd.env; do
  BASE="${ENV##*/}"
  STEM="${BASE%".sshfwd.env"}"
  NAME=$(systemd-escape -- "$STEM")
  ln -snf -- /usr/local/lib/systemd/system/1-ssh-forward@.service "$WANTS/1-ssh-forward@$NAME.service"
done
