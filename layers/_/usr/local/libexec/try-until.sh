#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

INTERVAL="$1"
shift -- 1

NOW="$(date -- '+%s')"
NEXT=$((NOW + INTERVAL))

while ! "$@"; do
  NOW="$(date -- '+%s')"
  if ((NOW >= NEXT)); then
    NEXT=$((NOW + INTERVAL))
  else
    sleep -- "$INTERVAL"
  fi
done
