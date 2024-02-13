#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

BASE="$(realpath -- "${0%/*}")"

set -a
# shellcheck disable=SC1091
source -- "$BASE/facts/.env"
set +a

NAME="$1"
shift -- 1

exec -- "$BASE/var/bin/tofu" -chdir="$BASE/terraform/$NAME" "$@"
