#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

MACHINE="$1"
shift -- 1

jq --exit-status --arg mach "$MACHINE" --slurp --sort-keys 'add | .machine = $mach' "$@"
