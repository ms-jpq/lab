#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

cd -- "${0%/*}/.."

INSTANCE="$1"
IFACE="$2"
DOMAIN="$3"
TTL="$4"
CONF_D="/run/dnsmasq/$INSTANCE/conf.d"

IPV4_ADDR="$(<"/run/ipv4/alloc/$IFACE")"
I4="$(ipcalc-ng --json -- "$IPV4_ADDR" | jq --exit-status --raw-output '.MINADDR, .MAXADDR')"
readarray -t -d $'\n' -- IPV_4 <<<"$I4"
IPV4_LO="${IPV_4[0]%%1}2"
IPV4_HI="${IPV_4[1]}"

export -- TTL IPV4_LO IPV4_HI
envsubst <./5-ip.conf | sponge -- "$CONF_D/5-ip.conf"

for FILE in ./if.d/"$INSTANCE"/**/*; do
  if [[ -x "$FILE" ]]; then
    NAME="$(basename -- "$FILE")"
    NAME="${NAME%%.*}"
    "$FILE" "$IFACE" "$DOMAIN" | sponge -- "$CONF_D/$NAME.conf"
  fi
done
