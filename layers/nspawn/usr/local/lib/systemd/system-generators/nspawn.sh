#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail
shopt -u failglob

RUN="$1"
BASE="${0##*/}"
BASE="${BASE%'.sh'}"
WANTS="$RUN/0-$BASE.target.wants"
SWANTS="$RUN/sockets.target.wants"

mkdir -v -p -- "$WANTS" "$SWANTS"

for TAG in "/var/cache/local/$BASE/services"/*/.#*.{service,socket}; do
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
