#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

if [[ -f /.dockerenv ]]; then
  exit 0
fi

# shellcheck disable=SC1091
source -- /usr/local/etc/default/shares.env

# shellcheck disable=SC2154
readarray -t -d ',' -- ROWS <<<"$SMB_EXPORTS"

NUS=(net --configfile "${0%/*}/../smb.conf" usershare)

for ROW in "${ROWS[@]}"; do
  ROW="${ROW//[[:space:]]/''}"
  if [[ -z "$ROW" ]]; then
    continue
  fi

  DIR="/media/$ROW"
  NAME="${ROW##*/}"
  mkdir -v -p -- "$DIR"
  "${NUS[@]}" add "$NAME" "$DIR" '' 'everyone:F' 'guest_ok=y'
done

exec -- "${NUS[@]}" list --long
