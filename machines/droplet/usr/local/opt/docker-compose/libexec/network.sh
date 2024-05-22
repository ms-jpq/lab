#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

NET=traefik

NS="$(docker network ls --format 'json' | jq --raw-output '.Name')"
readarray -t -- NETWORKS <<< "$NS"

for NETWORK in "${NETWORKS[@]}"; do
  if [[ $NETWORK == "$NET" ]]; then
    exit
  fi
done

exec -- docker network create --internal -- "$NET"
