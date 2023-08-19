#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

printf -- '%q ' "$@"
printf -- '\n'
"${0%/*}/hr.sh" '>'
"$@"
"${0%/*}/hr.sh" '<'
