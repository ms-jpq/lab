#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

cd -- "${0%/*}/.."

PIDS=()
for EXEC in ./dhcp-script.d/*; do
  if [[ -x "$EXEC" ]]; then
    "$EXEC" "$@" &
    PIDS+=("$!")
  fi
done

STATUS=0
for PID in "${PIDS[@]}"; do
  if ! wait -- "$PID"; then
    STATUS=$((STATUS + 1))
  fi
done

exit $((STATUS))
