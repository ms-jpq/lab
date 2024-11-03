#!/usr/bin/env -S -- bash -Eeu -o pipefail -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

SETTINGS="$1"

read -r -d '' -- JQ <<- 'JQ' || true
.["rpc-whitelist-enabled"] = false
JQ

if [[ -f $SETTINGS ]]; then
  jq --exit-status "$JQ" < "$SETTINGS" | sponge -- "$SETTINGS"
fi
