#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

CURL=(
  curl
  --fail
  --location
  --remove-on-error
  --create-dirs
  --no-progress-meter
)

if ! [[ -v UNDER ]]; then
  OUT="$1"
  COUNT="${2:-7}"
  URI="https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=$COUNT"
  JQ=(
    jq
    --exit-status
    --raw-output
  )

  read -r -d '' -- JQ1 << 'JQ' || true
[.images[] | "\(.startdate | sub("^(?<y>.{4})(?<m>.{2})(?<d>.{2})$"; "\(.y)_\(.m)_\(.d)") ) https://bing.com\(.url | sub("&.+$"; "")) \((.title | gsub("\\s"; " ")))"] | join("\u0000")
JQ

  "${CURL[@]}" -- "$URI" | "${JQ[@]}" "$JQ1" | UNDER=1 xargs --no-run-if-empty --null --max-args 1 --max-procs 0 -- "$0" "$OUT"
else
  OUT="$1"
  CUT=(
    cut
    --delimiter ' '
    --fields
  )
  set -x
  DATE="$("${CUT[@]}" 1,1 <<< "$2")"
  URI="$("${CUT[@]}" 2,2 <<< "$2")"
  TITLE="$("${CUT[@]}" 3- <<< "$2")"

  NAME="$OUT/$DATE $TITLE.${URI##*.}"
  if ! [[ -f $NAME ]]; then
    "${CURL[@]}" --output "$NAME" -- "$URI"
  fi
fi
