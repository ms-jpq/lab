#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O globstar

set -o pipefail

RUN="$1"
WANTS="$RUN/default.target.wants"

# shellcheck disable=SC1091
source -- /usr/local/etc/default/lan.env

# shellcheck disable=SC2154
readarray -t -d ' ' -- INTERFACES <<<"$LAN_IFS"

mkdir -v -p -- "$WANTS"
for NAME in "${INTERFACES[@]}"; do
  NAME="${NAME//[[:space:]]/''}"
  ln -v -sf -- /usr/local/lib/systemd/system/1-lan@.service "$WANTS/1-lan@$NAME.service"
done
