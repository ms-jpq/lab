#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail
shopt -u failglob

RUN="$1"
WANTS="$RUN/timers.target.wants"

# shellcheck disable=SC1091
source -- /usr/local/etc/default/journal.env

# shellcheck disable=SC2154
readarray -t -d ',' -- HOSTS <<< "$JOURNAL_HOSTS"

mkdir -v -p -- "$WANTS"
for NAME in "${HOSTS[@]}"; do
  NAME="$(systemd-escape -- "${NAME//[[:space:]]/''}")"
  ln -v -snf -- /usr/local/lib/systemd/system/1-journal@.timer "$WANTS/1-journal@$NAME.timer"
done
