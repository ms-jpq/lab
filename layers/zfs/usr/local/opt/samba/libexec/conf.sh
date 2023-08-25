#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

RUN="$1"

for CONF in "${0%/*}/../conf.d"/*.conf; do
  printf -- '%s\n' "include = $CONF"
done | sponge -- "$RUN"
