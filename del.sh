#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

ip --json -6 route | jq --raw-output '.[] | select(.type == "unreachable").dst' | xargs --no-run-if-empty -L 1 -- ip -6 route del
