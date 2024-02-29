#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

if [[ -f /.dockerenv ]]; then
  exit 0
fi

BASE="${0%/*}/.."
CONF="$1"
ENV="$2"
SMB_EXPORTS="$(sed -E -e 's/^SMB_EXPORTS=//' -- "$ENV")"

USERNAME="$(id --name --user -- 1000)"
# usermod --append --groups sambashare -- "$USERNAME"

# shellcheck disable=SC2154
readarray -t -d ',' -- ROWS <<<"$SMB_EXPORTS"
NUS=(net --configfile "$CONF" usershare)

export -- SHARE

for ROW in "${ROWS[@]}"; do
  ROW="${ROW//[[:space:]]/''}"
  if [[ -z "$ROW" ]]; then
    continue
  fi

  DIR="/media/$ROW"
  NAME="${ROW##*/}"
  mkdir -v -p -- "$DIR"
  chown -v -- "$USERNAME":"$USERNAME" "$DIR"
  SHARE="$(systemd-escape -- "$NAME")"
  DNSSD="/usr/local/lib/systemd/dnssd/smb-$SHARE.dnssd"
  envsubst <"$BASE/smb.dnssd" >"$DNSSD"
  chown -v -- systemd-resolve:systemd-resolve "$DNSSD"
  runuser --user "$USERNAME" -- "${NUS[@]}" add "$NAME" "$DIR" '' 'everyone:F' 'guest_ok=y'
done

exec -- "${NUS[@]}" list --long
