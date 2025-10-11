#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

if ! [[ -v UNDER ]]; then
  while true; do
    if UNDER=1 "$0" "$@"; then
      :
    else
      if [[ $? == 143 ]]; then
        :
      else
        exit 1
      fi
    fi
  done
fi

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
  --config -
)

if [[ -f $JOURNAL ]]; then
  F="$(mktemp)"
  journalctl --output json --reverse --lines 0 --merge --cursor-file "$F" > /dev/null
  CURSOR="$(< "$F")"
  CAT+=(--header "Range: entries=$CURSOR")
fi
CAT+=(-- "http://$REMOTE:8080/entries?follow")

RTAIL=(
  chronic
  --
  /usr/lib/systemd/systemd-journal-remote
  --output "$JOURNAL"
  -- -
)

PASSWD="8080:$({
  tr --delete -- '\n' < /usr/local/etc/default/nginx-8080.env
  cut --delimiter '.' --field 1 <<< "$REMOTE"
} | b3sum | cut -d ' ' -f 1)"
timeout --preserve-status "$TIMEOUT" "${CAT[@]}" <<< "--user $PASSWD" | "${RTAIL[@]}"
