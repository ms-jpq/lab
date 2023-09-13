#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

CONF="$1"
shift -- 1

NPROC="$(nproc)"

ARGV=(
  rclone sync
  --check-first
  --order-by size
  --create-empty-src-dirs
  --fast-list
  --multi-thread-streams $((NPROC * 2))
  --config "$CONF"
  --progress
)

if ! [[ -v INVOCATION_ID ]] && ! [[ -v NO_DRY_RUN ]]; then
  ARGV+=(--dry-run)
fi

exec -- "${ARGV[@]}" -- /media "$@"
