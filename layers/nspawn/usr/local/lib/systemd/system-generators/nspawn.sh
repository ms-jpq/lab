#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O globstar

set -o pipefail

RUN="$1"
BASE="${0##*/}"
BASE="${BASE%'.sh'}"
WANTS="$RUN/0-$BASE.target.wants"

mkdir -v -p -- "$WANTS"
for TAG in "/var/lib/local/$BASE"/*/.#*.{service,socket}; do
  SVC="${TAG##*/}"
  SVC="${SVC#'.#'}"
  MACH="${TAG%/*}"
  MACH="$(systemd-escape -- "${MACH##*/}")"
  ln -v -sf -- "/usr/local/lib/systemd/system/$SVC" "$WANTS/${SVC//'@'/"@$MACH"}"
done
