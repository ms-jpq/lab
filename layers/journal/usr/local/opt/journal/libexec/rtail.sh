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
  --header 'Accept: application/vnd.fdo.journal'
)

if [[ -f "$JOURNAL" ]]; then
  CURSOR="$(journalctl --output json --reverse --lines 1 --file "$JOURNAL" | jq --exit-status --raw-output '.__CURSOR')"
  AT="Range: entries=$CURSOR"
  CAT+=(--header "$AT")
fi
CAT+=(-- "http://$REMOTE:8080/entries?follow")

TAIL=(
  systemd-cat
  --identifier systemd-journal-remote
  --
  /usr/lib/systemd/systemd-journal-remote
  --output "$JOURNAL"
  -- -
)

timeout --preserve-status "$TIMEOUT" "${CAT[@]}" | "${TAIL[@]}"
