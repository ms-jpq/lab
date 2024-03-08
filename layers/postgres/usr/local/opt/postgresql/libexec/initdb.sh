#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

CLUSTER="$1"
PGDATA="$2"
USER=postgres

mkdir -v -p -- "$PGDATA"
chown -v -- "$USER:$USER" "$PGDATA"
exec -- runuser --user "$USER" -- "${0%/*}/pg-path.sh" "$CLUSTER" initdb --pgdata "$PGDATA"
