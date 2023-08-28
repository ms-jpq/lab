#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

SLEEP="$1"
shift -- 1

until "$@"; do
  sleep -- "$SLEEP"
done
