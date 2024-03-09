#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

if ! systemd-notify --booted; then
  exit 0
fi

CONF="$1"
ENV="$2"
SMB_EXPORTS="$(sed -E -e 's/^SMB_EXPORTS=//' -- "$ENV")"

USERNAME="$(id --name --user -- 1000)"
# usermod --append --groups sambashare -- "$USERNAME"

# shellcheck disable=SC2154
readarray -t -d ',' -- ROWS <<<"$SMB_EXPORTS"
NUS=(net --configfile "$CONF" usershare)

for ROW in "${ROWS[@]}"; do
  ROW="${ROW//[[:space:]]/''}"
  if [[ -z "$ROW" ]]; then
    continue
  fi

  DIR="/media/$ROW"
  NAME="${ROW##*/}"
  mkdir -v -p -- "$DIR"
  chown -v -- "$USERNAME":"$USERNAME" "$DIR"
  runuser --user "$USERNAME" -- "${NUS[@]}" add "$NAME" "$DIR" '' 'everyone:F' 'guest_ok=y'
done

exec -- "${NUS[@]}" list --long
