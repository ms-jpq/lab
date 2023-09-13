#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

ACCOUNT="$2"
STORE="$1/$ACCOUNT"
mkdir -v -p -- "$STORE"
