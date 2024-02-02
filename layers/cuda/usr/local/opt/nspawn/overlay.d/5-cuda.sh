#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

ROOT="$1"

FILES=(
  /etc/apt/sources.list.d/cuda.list
  /etc/apt/trusted.gpg.d/cuda.gpg
)

for FILE in "${FILES[@]}"; do
  cp -v -a -f -- "$FILE" "$ROOT$FILE"
done
