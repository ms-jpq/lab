#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O globstar

set -o pipefail

RUN="$1"
WANTS="$RUN/multi-user.target.wants"

mkdir -v -p -- "$WANTS"
for CLUSTER in /usr/local/opt/postgresql/clusters/*/; do
  CLUSTER="${CLUSTER%/}"
  CLUSTER="${CLUSTER##*/}"
  VERSION="${CLUSTER%%'-'*}"
  NAME="${CLUSTER#*'-'}"
  ln -v -sf -- /usr/lib/systemd/system/postgresql@.service "$WANTS/postgresql@$VERSION-$NAME.service"
done
