#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

CURSOR="$1"
REMOTE="$2"
OUTPUT="${3:-""}"

CAT=(
  curl
  --fail
  --location
  --no-buffer
  --no-progress-meter
  --header 'Accept: application/vnd.fdo.journal'
)
RECORD="$CURSOR.cursor"
if [[ -f "$RECORD" ]]; then
  AT="Range: entries=$(<"$RECORD")"
  printf -- '%s\n' "$REMOTE -> $AT" >&2
  CAT+=(--header "$AT")
fi
CAT+=(-- "http://$REMOTE:8080/entries?follow")

TEE=(
  "${0%/*}/rtail.py"
  --name "$REMOTE"
  -- "$CURSOR"
)

if [[ -z "$OUTPUT" ]]; then
  TAIL=(cat)
else
  TAIL=(
    /usr/lib/systemd/systemd-journal-remote
    --output "$OUTPUT"
    -- -
  )
fi

"${CAT[@]}" | "${TEE[@]}" | "${TAIL[@]}"
