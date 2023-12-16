#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

cd -- "${0%/*}"

CACHE=/var/cache/local/weechat
ARGV=(
  "$CACHE/venv/bin/python3"
  -m pip
  install
  --cache-dir "$CACHE/pip"
  --requirement "$CACHE/weechat-matrix/requirements.txt"
  --
  future
  websocket-client
)
exec -- "${ARGV[@]}"
