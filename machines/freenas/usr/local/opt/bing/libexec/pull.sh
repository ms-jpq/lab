#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

OUT="$1"

CURL=(
  curl
  --fail-with-body
  --location
  --create-dirs
  --no-progress-meter
)

if ! [[ -v UNDER ]]; then
  COUNT="${2:-7}"
  URI="https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=$COUNT"
  JQ=(
    jq
    --exit-status
    --raw-output
  )

  read -r -d '' -- JQ1 <<'JQ' || true
.images[] | "\(.startdate | sub("^(?<y>.{4})(?<m>.{2})(?<d>.{2})$"; "\(.y)_\(.m)_\(.d)") ) https://bing.com\(.url | sub("&.+$"; "")) \((.title | gsub("\\s"; " ")))"
JQ

  "${CURL[@]}" -- "$URI" | "${JQ[@]}" "$JQ1" | UNDER=1 xargs --no-run-if-empty -L 1 --max-procs 0 -- "$0" "$OUT"
else
  DATE="$2"
  URI="$3"
  shift -- 3
  TITLE="$*"
  NAME="$OUT/$DATE $TITLE.${URI##*.}"
  if ! [[ -f "$NAME" ]]; then
    TMP="$NAME.tmp"
    "${CURL[@]}" --output "$TMP" -- "$URI"
    mv -v -f -- "$TMP" "$NAME"
  fi
fi
