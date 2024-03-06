#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O globstar

set -o pipefail

if [[ -v UNDER ]]; then
  CODE=0
  FILE="$1"
  COMPOSE=(
    docker compose
    --file "$FILE"
    --progress plain
  )
  UP=(
    "${COMPOSE[@]}"
    up
    --detach
    --remove-orphans
  )
  DOWN=(
    "${COMPOSE[@]}"
    down
    --remove-orphans
  )
  if ! "${UP[@]}"; then
    if "${DOWN[@]}" && ! "${UP[@]}"; then
      CODE=1
      {
        printf -- '%q ' "$@"
        printf -- '\n'
      } >&2
    fi
  fi
  exit "$CODE"
fi

BASE="${0%/*}"
NETWORK="$BASE/network.sh"

if [[ -x "$NETWORK" ]]; then
  "$NETWORK"
fi

XARGS=(
  xargs
  --null
  -I '%'
  --max-procs 0
  -- "$0" '%'
)

printf -- '%s\0' "$BASE/../stacks"/*/docker-compose.yml | UNDER=1 "${XARGS[@]}"
