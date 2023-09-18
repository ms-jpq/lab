#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O globstar

set -o pipefail

# shellcheck disable=2154
"${0%/*}/apriori.sh" "$MACHINE" "$ROOT"
AS=("$@")
if [[ -z "${ARGV:-""}" ]]; then
  for ISO in /var/cache/local/qemu/ubuntu-*.iso; do
    AS+=(--disc "$ISO")
  done
fi

exec -- "${0%/*}/../bin/q35.sh" "${AS[@]}"
