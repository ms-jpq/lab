#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

export -- RCLONE_TRANSFERS=8
# export -- BWLIMIT='04:00,800K:off 00:00,off'

ARGV=(
  rclone.sh sync
  -v
  --use-mmap
  --dscp LE
  --order-by size
  --exclude-if-present .noclone
  --create-empty-src-dirs
)

if ! [[ -v INVOCATION_ID ]]; then
  ARGV+=(--dry-run)
fi

exec -- "${ARGV[@]}" -- /media "$@"
