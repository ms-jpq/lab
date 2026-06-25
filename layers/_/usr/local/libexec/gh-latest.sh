#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

TMP="$1"
REPO="$2"
NAME="${REPO/\//.}"
CACHE="$TMP/$NAME.cache"

mkdir -v -p -- "$TMP" >&2

if ! [[ -v LOCKED ]] && command -v -- flock > /dev/null; then
  LOCK="$TMP/$NAME.lock"
  LOCKED=1 exec -- flock "$LOCK" "$0" "$@"
fi

if [[ -f $CACHE ]]; then
  find "$CACHE" -type f -mmin '+60' -delete
fi

if ! [[ -f $CACHE ]]; then
  CURL=(
    curl
    --fail
    --location
    --no-progress-meter
    --max-time 60
    --output /dev/null
    --write-out '%{url_effective}'
  )
  CURL+=(-- "https://github.com/$REPO/releases/latest")

  URL="$("${CURL[@]}")"
  TAG="${URL##*/}"

  printf -- '%s' "$TAG" > "$CACHE"
fi

exec -- cat -- "$CACHE"
