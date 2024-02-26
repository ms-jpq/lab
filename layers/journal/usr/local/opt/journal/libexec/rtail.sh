#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

OUTPUT="$1"
REMOTE="$2"

CAT=(
  curl
  --fail
  --location
  --no-progress-meter
  --header 'Accept: application/vnd.fdo.journal'
  -- "http://$REMOTE:8080/entries?follow"
)

"${CAT[@]}" | "${0%/*}/rtail.py"

# "${CAT[@]}" | /usr/lib/systemd/systemd-journal-remote --output "$OUTPUT" -- -
