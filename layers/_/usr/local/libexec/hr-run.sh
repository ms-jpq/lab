#!/usr/bin/env -S -- bash -Eeuo pipefail -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

HR="${0%/*}/hr.sh"
printf -- '%s\n' "${*@Q}"
"$HR" '>'
"$@"
"$HR" '<'
