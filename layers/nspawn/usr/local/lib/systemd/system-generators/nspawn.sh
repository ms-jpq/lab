#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O globstar

set -o pipefail

RUN="$1"
BASE="${0##*/}"
BASE="${BASE%'.sh'}"
WANTS="$RUN/0-$BASE.target.wants"
SWANTS="$RUN/sockets.target.wants"

mkdir -v -p -- "$WANTS" "$SWANTS"

for TAG in "/var/lib/local/$BASE"/*/.#*.{service,socket}; do
  SVC="${TAG##*/}"
  SVC="${SVC#'.#'}"
  MACH="${TAG%/*}"
  MACH="$(systemd-escape -- "${MACH##*/}")"

  case "$SVC" in
  *.socket)
    DIR="$SWANTS"
    ;;
  *)
    DIR="$WANTS"
    ;;
  esac
  ln -v -sf -- "/usr/local/lib/systemd/system/$SVC" "$DIR/${SVC//'@'/"@$MACH"}"
done
