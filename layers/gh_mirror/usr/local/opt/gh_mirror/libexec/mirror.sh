#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

ACCOUNT="$2"
STORE="$1/$ACCOUNT"

RS="$("${0%/*}/ls-repos.sh" "$ACCOUNT" | shuf)"
readarray -t -- REPOS <<<"$RS"

for REPO in "${REPOS[@]}"; do
  "${0%/*}/mirror-repo.sh" "$STORE" "$REPO"
done
