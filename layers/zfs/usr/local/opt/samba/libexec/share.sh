#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail
set -x

env

if [[ -v CI ]]; then
  exit 0
fi

# shellcheck disable=SC1091
source -- /usr/local/etc/default/shares.env

# shellcheck disable=SC2154
readarray -t -d ',' -- ROWS <<<"$SMB_EXPORTS"

for ROW in "${ROWS[@]}"; do
  ROW="${ROW//[[:space:]]/''}"
  DIR="/media/$ROW"
  mkdir -v -p -- "$DIR"
  net usershare add "$ROW" "$DIR" "$ROW" 'everyone:F' 'guest_ok=y'
done

exec -- net usershare list --long
