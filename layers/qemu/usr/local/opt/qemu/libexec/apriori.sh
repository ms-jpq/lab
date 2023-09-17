#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

MACHINE="$1"
ROOT="$2"

for BIN in "${0%/*}/../apriori.d"/*; do
  if [[ -x "$BIN" ]]; then
    "$BIN" "$MACHINE" "$ROOT"
  fi
done
