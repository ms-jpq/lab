#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

CONF="$1"

cat -- "${0%/*}/../conf.d"/* | envsubst | sponge -- "$CONF"
