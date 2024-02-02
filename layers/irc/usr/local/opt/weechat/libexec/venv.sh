#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

CACHE="$1"
WEECACHE="$CACHE/weechat"

ARGV=(
  "$WEECACHE/venv/bin/python3"
  -m pip
  install
  --cache-dir "$CACHE/pip"
  --requirement "$WEECACHE/weechat-matrix/requirements.txt"
  --
  future
  websocket-client
)
exec -- "${ARGV[@]}"
