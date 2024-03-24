#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O globstar

set -o pipefail

CACHE="$1"
STATE="$2"
OVPN_SERVER_NAME="$3"
OVPN_TCP_PORT="$4"
OVPN_UDP_PORT="$5"
OVPN_PEERS="$6"

SELF="${0%/*}/.."
TITLE=openvpn

rm -v -fr -- "${CACHE:?}"/*

export -- OVPN_SERVER_NAME OVPN_SERVER_PORT

declare -A -- PROTOCOLS=()

PROTOCOLS=(
  ['tcp-client']="$OVPN_TCP_PORT"
  ['udp']="$OVPN_UDP_PORT"
)

P="$(sort --unique --field-separator ',' <<<"$OVPN_PEERS")"
readarray -t -d ',' -- PEERS <<<"$P"

OVPN_IDS=()
for PEER in "${PEERS[@]}"; do
  PEER="$(printf -- '%s' "${PEER//[[:space:]]/''}" | jq --slurp --raw-input --raw-output '@uri')"
  if [[ -z "$PEER" ]]; then
    continue
  fi

  CRT="$STATE/$PEER.crt"
  if ! [[ -f "$CRT" ]]; then
    :
  fi

  for PROTOCOL in "${!PROTOCOLS[@]}"; do
    OVPN_SERVER_PORT="${PROTOCOLS[$PROTOCOL]}"
    SHORT="${PROTOCOL%-*}"

    NAME="$PEER-$SHORT"
    CONF="$CACHE/$NAME.txt"
    {
      envsubst <"$SELF/client.ovpn"
      cat -- "$SELF/common.ovpn" "$SELF/$SHORT.ovpn"
    } | sponge -- "$CONF"
    OVPN_IDS+=("$NAME")
  done
done

IFS=','
/usr/local/libexec/m4.sh -D"ENV_TITLE=$TITLE" -D"ENV_PEER=${OVPN_IDS[*]}" "$SELF/index.html" | sponge -- "$CACHE/index.html"
