#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail
set -x

curl -v --unix /run/local/nginx/htpasswd.sock -- http://localhost

CURL=(
  curl -v
  --show-error --styled-output
  --unix '/run/local/nginx/auth-proxy.sock'
  "$@"
  -- 'http://curl.localhost:8080/abc?def=ghi'
)

"${CURL[@]}"
