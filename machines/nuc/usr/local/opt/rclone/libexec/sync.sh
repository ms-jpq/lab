#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

TRANSFERS=8

ARGV=(
  rclone.sh sync
  -v
  --use-mmap
  --order-by 'size,mixed'
  --create-empty-src-dirs
  --transfers "$TRANSFERS"
  --
  jotta_src:
  jotta_dst:
)

if ! [[ -v INVOCATION_ID ]]; then
  ARGV+=(--dry-run)
fi

exec -- "${ARGV[@]}"
