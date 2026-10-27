#!/usr/bin/env -S -- bash -Eeuo pipefail -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail
shopt -u failglob

RUN="$1"
WANTS=("$RUN/multi-user.target.wants" "$RUN/postgresql.service.wants")

# shellcheck disable=SC1091
source -- /usr/local/etc/default/postgresql.env

: "${PG_CLUSTERS?}"
readarray -t -d ',' -- CLUSTERS <<< "$PG_CLUSTERS"

mkdir -v -p -- "${WANTS[@]}"
for CLUSTER in "${CLUSTERS[@]}"; do
  CLUSTER="$(systemd-escape -- "${CLUSTER//[[:space:]]/}")"
  VERSION="${CLUSTER%%'-'*}"
  NAME="${CLUSTER#*'-'}"
  for DIR in "${WANTS[@]}"; do
    ln -v -sTnf -- /usr/lib/systemd/system/postgresql@.service "$DIR/postgresql@$VERSION-$NAME.service"
  done
done
