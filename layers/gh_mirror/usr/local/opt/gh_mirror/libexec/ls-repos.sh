#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

USER="$1"
REPOS="${NEXT_URI:-"https://api.github.com/users/$USER/repos"}"
TMP="$(mktemp)"

CURL=(
  curl
  --fail-with-body
  --location
  --no-progress-meter
  --write-out '%{header_json}'
  --output "$TMP"
  -- "$REPOS"
)

LS="$("${CURL[@]}" | jq --exit-status --raw-output '.link[]')"
readarray -t -d ',' -- LLS <<<"$LS"

export -- NEXT_URI=''
for L in "${LLS[@]}"; do
  L="${L//[[:space:]]/}"
  if [[ "$L" =~ ^\<([^\>]+)\>\;rel=\"([^\"]+)\"$ ]]; then
    LINK="${BASH_REMATCH[1]}"
    REL="${BASH_REMATCH[2]}"
    if [[ "$REL" == 'next' ]]; then
      NEXT_URI="$LINK"
    fi
  else
    set -x
    exit 1
  fi
done

jq --exit-status --raw-output '.[].clone_url' "$TMP"
if [[ -n "$NEXT_URI" ]]; then
  exec -- "$0" "$@"
fi
