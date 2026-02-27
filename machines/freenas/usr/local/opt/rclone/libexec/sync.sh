#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

export -- RCLONE_TRANSFERS=8

ARGV=(
  rclone.sh sync
  -v
  --use-mmap
  --dscp LE
  --human-readable
  --order-by 'size,mixed'
  --exclude-if-present .noclone
  --create-empty-src-dirs
)

if ! [[ -v INVOCATION_ID ]]; then
  ARGV+=(--dry-run)
fi

exec -- "${ARGV[@]}" -- /media "$@"
