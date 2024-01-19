#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O globstar

set -o pipefail

NETWORK="${0%/*}/network.sh"

if [[ -x "$NETWORK" ]]; then
  "$NETWORK"
fi

cd -- "${0%/*}/../stacks"

printf -- '%s\0' ./*/docker-compose.yml | xargs --null -I '%' --max-args 1 --max-procs 0 -- docker compose --file '%' up --detach --remove-orphans "$@"
