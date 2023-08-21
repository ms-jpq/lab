#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

HR="${0%/*}/hr.sh"
printf -- '%q ' "$@"
printf -- '\n'
"$HR" '>'
"$@"
"$HR" '<'
