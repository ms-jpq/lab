#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

TMP="$1"
REPO="$2"
NAME="${REPO/\//.}"
CACHE="$TMP/$NAME.cache"

mkdir -v -p -- "$TMP" >&2

if ! [[ -v LOCKED ]] && command -v -- flock >/dev/null; then
  LOCK="$TMP/$NAME.lock"
  LOCKED=1 exec -- flock "$LOCK" "$0" "$@"
fi

if ! [[ -f "$CACHE" ]]; then
  CURL=(
    curl --fail
    --location
    --no-progress-meter
    --max-time 60
    -- "https://api.github.com/repos/$REPO/releases/latest"
  )
  JQ=(
    jq --exit-status
    --raw-output '.tag_name'
  )

  LINES="$("${CURL[@]}" | "${JQ[@]}")"
  readarray -t -- TAGS <<<"$LINES"
  printf -- '%s' "${TAGS[0]}" >"$CACHE"
fi

exec -- cat -- "$CACHE"
