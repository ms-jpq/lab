#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

REMOTE="$1"
JOURNAL="$2"
TIMEOUT="$3"

CAT=(
  curl
  --fail
  --location
  --no-buffer
  --no-progress-meter
  --max-time "$TIMEOUT"
  --header 'Accept: application/vnd.fdo.journal'
)

if [[ -f "$JOURNAL" ]]; then
  CURSOR="$(journalctl --output json --reverse --lines 1 --file "$JOURNAL" | jq --exit-status --raw-output '.__CURSOR')"
  AT="Range: entries=$CURSOR"
  printf -- '%s\n' "$REMOTE -> $AT" >&2
  CAT+=(--header "$AT")
fi
CAT+=(-- "http://$REMOTE:8080/entries?follow")

TAIL=(
  /usr/lib/systemd/systemd-journal-remote
  --output "$JOURNAL"
  -- -
)

"${CAT[@]}" | "${TAIL[@]}"
