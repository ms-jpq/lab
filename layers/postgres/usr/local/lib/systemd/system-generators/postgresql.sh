#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O globstar

set -o pipefail

RUN="$1"
WANTS="$RUN/postgresql.service.wants"

# shellcheck disable=SC1091
source -- /usr/local/etc/default/postgresql.env

# shellcheck disable=SC2154
readarray -t -d ',' -- CLUSTERS <<<"$PG_CLUSTERS"

mkdir -v -p -- "$WANTS"
for CLUSTER in "${CLUSTERS[@]}"; do
  CLUSTER="$(systemd-escape -- "${CLUSTER//[[:space:]]/''}")"
  VERSION="${CLUSTER%%'-'*}"
  NAME="${CLUSTER#*'-'}"
  ln -v -sf -- /usr/lib/systemd/system/postgresql@.service "$WANTS/postgresql@$VERSION-$NAME.service"
done
