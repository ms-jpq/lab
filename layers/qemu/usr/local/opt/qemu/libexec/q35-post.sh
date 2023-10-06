#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

SOCK="$1"

if [[ -n "$SOCK" ]]; then
  /usr/local/libexec/retry.sh 0.1 stat -- "$SOCK"
fi
