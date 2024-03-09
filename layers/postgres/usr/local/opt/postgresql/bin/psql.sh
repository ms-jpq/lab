#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

CLUSTER="$1"
shift -- 1
HOST="/run/local/postgresql/$CLUSTER"

exec -- psql --host "$HOST" --username postgres "$@"
