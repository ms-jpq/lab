#!/usr/bin/env -S -- bash -Eeuo pipefail -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

SELF="$(realpath -- "$0")"
BASE="${SELF%/*}"

exec -- env -- PYTHONPATH="${BASE%/*}" PYTHONSAFEPATH= python3 -m media "$@"
