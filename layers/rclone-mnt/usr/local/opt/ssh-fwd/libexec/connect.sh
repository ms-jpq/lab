#!/usr/bin/env -S -- bash -Eeu -o pipefail -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

TARGET="$1"
PORT="$2"
IDENTITY="$3"
shift -- 3

SSH=(
  ssh
  -p "$PORT"
  -i "$IDENTITY"
  "$@"
  --
  "$TARGET"
)

exec -- "${SSH[@]}"
