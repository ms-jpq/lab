#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

COUNT=7
URI="https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=$COUNT"
CURL=(
  curl
  --fail-with-body
  --location
  --create-dirs
  --no-progress-meter
)

JQ=(
  jq
  --exit-status
  --raw-output
)

read -r -d '' -- JQ1 <<'JQ' || true
.images[] | (.title | gsub("\\s"; " ")), "https://bing.com\(.url | sub("&.+$"; ""))"
JQ

"${CURL[@]}" -- "$URI" | "${JQ[@]}" "$JQ1"
