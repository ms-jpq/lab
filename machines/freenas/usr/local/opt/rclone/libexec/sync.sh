#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

NPROC="$(nproc)"

ARGV=(
  rclone.sh sync
  -vv
  --use-mmap
  --order-by size
  --exclude-if-present .noclone
  --create-empty-src-dirs
  --transfers $((NPROC * 2))
  --multi-thread-streams $((NPROC * 2))
)

if ! [[ -v INVOCATION_ID ]]; then
  ARGV+=(--dry-run)
fi

exec -- "${ARGV[@]}" -- /media "$@"
