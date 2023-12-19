#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O globstar

set -o pipefail

cd -- "${0%/*}/../stacks"

for STACK in ./*/docker-compose.yml; do
  docker compose --file "$STACK" up --detach --remove-orphans
done
