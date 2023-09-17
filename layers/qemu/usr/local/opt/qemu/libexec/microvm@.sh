#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

# shellcheck disable=2154
"${0%/*}/apriori.sh" "$MACHINE" "$ROOT"
exec -- "${0%/*}/../bin/microvm.sh" "$@"
