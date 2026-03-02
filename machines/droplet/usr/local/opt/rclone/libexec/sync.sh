#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

CACHE_DIRECTORY='/media/spare'
export -- RCLONE_TRANSFERS=2

ARGV=(
  rclone.sh sync
  -v
  --human-readable
  --order-by 'size,descending'
  --exclude-if-present .noclone
  --create-empty-src-dirs
  --cache-dir "$CACHE_DIRECTORY/cache"
  --temp-dir "$CACHE_DIRECTORY/temp"
  --
  jotta-src:
  jotta-dst:
)

if ! [[ -v INVOCATION_ID ]]; then
  ARGV+=(--dry-run)
fi

exec -- "${ARGV[@]}"
