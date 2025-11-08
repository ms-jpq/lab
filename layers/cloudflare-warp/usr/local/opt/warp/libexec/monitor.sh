#!/usr/bin/env -S -- bash -Eeu -o pipefail -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

CURL=(
  curl
  --fail
  --location
  --no-progress-meter
  --proxy socks5://127.0.0.1:40000
  -- "$1"
)

systemd-notify --ready

while true; do
  "${CURL[@]}" && systemd-notify -- WATCHDOG=1 || :
  sleep -- 9
done
