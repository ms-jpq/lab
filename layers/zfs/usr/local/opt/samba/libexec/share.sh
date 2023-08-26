#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

readarray -t -d ',' -- ROWS <<<""

for ROW in "${ROWS[@]}"; do

  readarray -t -d '|' -- COLS <<<"$ROW"
  NAME="${COLS[0]}"
  DIR="${COLS[1]}"

  if [[ -z "$NAME" ]]; then
    continue
  fi
  net usershare add "$NAME" "$DIR" "$NAME" 'everyone:F' 'guest_ok=y'
done

exec -- net usershare list --long
