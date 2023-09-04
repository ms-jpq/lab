#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

for BIN in "${0%/*}/../apriori.d"/*; do
  if [[ -x "$BIN" ]]; then
    # shellcheck disable=SC2154
    "$BIN" "$MACHINE" "$DRIVE_ROOT"
  fi
done

exec -- "${0%/*}/../bin/microvm.sh" "$@" --drive "$CLOUD_INIT"
