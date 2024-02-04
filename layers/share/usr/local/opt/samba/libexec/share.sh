#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

if [[ -f /.dockerenv ]]; then
  exit 0
fi

USERNAME="$(id --name --user -- 1000)"
usermod --append --groups sambashare -- "$USERNAME"

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
  runuser --user "$USERNAME" -- "${NUS[@]}" add "$NAME" "$DIR" '' 'everyone:F' 'guest_ok=y'
done

exec -- "${NUS[@]}" list --long
