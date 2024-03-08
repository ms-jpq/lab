#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

CLUSTER="$1"
BIN="$2"
shift -- 2

VERSION="${CLUSTER%%'-'*}"

exec -- "/usr/lib/postgresql/$VERSION/bin/$BIN" "$@"
