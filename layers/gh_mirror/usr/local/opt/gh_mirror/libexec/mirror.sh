#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

ACCOUNT="$2"
STORE="$1/$ACCOUNT"
NPROC=6

"${0%/*}/ls-repos.sh" "$ACCOUNT" | shuf | xargs --no-run-if-empty -L 1 -P "$NPROC" -- "${0%/*}/mirror-repo.sh" "$STORE"
