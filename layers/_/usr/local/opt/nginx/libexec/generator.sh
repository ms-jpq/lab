#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

RUN="$1"
WWW="$2"
TMP="$3"

PIDS=()
for EXEC in "${0%/*}/../generators"/*; do
  if [[ -x "$EXEC" ]]; then
    "$EXEC" "$TMP" "$WWW" &
    PIDS+=("$!")
  fi
done
for PID in "${PIDS[@]}"; do
  wait -- "$PID"
done

if ! diff --recursive --brief -- "$TMP" "$RUN"; then
  rsync --recursive --perms -- "$TMP/" "$RUN/"
  systemctl try-reload-or-restart -- nginx.service
fi
