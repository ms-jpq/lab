#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail
set -x

SOCK='/run/local/nginx/auth-proxy.sock'
CURL=(
  curl -v
  --show-error --styled-output
  --unix "$SOCK"
  "$@"
  -- 'http://curl.localhost:8080/abc?def=ghi'
)

"${CURL[@]}"
