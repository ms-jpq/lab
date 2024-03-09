#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

CLUSTER="$1"
PGDATA="$2"
USER=postgres

ARGV=(
  env --ignore-environment
  --
  TZ=Etc/UTC
  "${0%/*}/pg-path.sh" "$CLUSTER"
  initdb
  --pgdata "$PGDATA"
  --locale C.UTF-8
)

mkdir -v -p -- "$PGDATA"
chown -v -- "$USER:$USER" "$PGDATA"
exec -- runuser --user "$USER" -- "${ARGV[@]}"
