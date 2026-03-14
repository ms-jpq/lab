#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

CACHE_DIRECTORY='/var/cache/local/rclone'
export -- RCLONE_TRANSFERS=8

ARGV=(
  rclone.sh sync
  -v
  --dscp LE
  --human-readable
  --exclude-if-present .noclone
  --order-by 'size,mixed'
  --cache-dir "$CACHE_DIRECTORY/cache"
  --temp-dir "$CACHE_DIRECTORY/temp"
  --exclude-if-present .noclone
  --create-empty-src-dirs
  --exclude '.Trash-0/*'
  --
  /media
  jotta-crypt:
)

if ! [[ -v INVOCATION_ID ]]; then
  ARGV+=(--dry-run)
fi

exec -- "${ARGV[@]}"
