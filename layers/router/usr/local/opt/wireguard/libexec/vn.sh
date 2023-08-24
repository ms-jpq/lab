#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O globstar

set -o pipefail
set -x

IFACE="$1"
DOMAIN="$2"
DNSMASQD="$3"
CACHE="$4"
VAR="$5"
NETDEV="$6"

SYSTEMD='/run/systemd/network'
SERVER_PRIVATE_KEY="$VAR/self.key"
PEER_CONF="${0%/*}/../peer.conf"

mkdir -v --parents -- "$SYSTEMD" "$VAR" "$CACHE"
SERVER_PUBLIC_KEY="$(wg pubkey <"$SERVER_PRIVATE_KEY")"
rm -v --force --recursive -- "${CACHE:?}"/*

# shellcheck disable=SC2086,SC2154
printf -v V4_NET -- '%02x' ${IPV4_NETWORK//./ }
# shellcheck disable=SC2086,SC2154
printf -v V4_MASK -- '%02x' ${IPV4_NETMASK//./ }

declare -A -- SEEN
SEEN=(
  ["$IPV4_MINADDR"]=1
  ["$IPV4_MAXADDR"]=1
)

WG_LINES=()
DNSMAQ_HOSTS=()

export -- DOMAIN IPV6 IPV4 SERVER_PUBLIC_KEY CLIENT_PRIVATE_KEY

# shellcheck disable=SC2154
P="$(sort --field-separator ',' <<<"$WG_PEERS")"
readarray -t -d ' ' -- PEERS <<<"$P"
for PEER in "${PEERS[@]}"; do
  PEER="${PEER%%$'\n'}"
  # export -- IPV4 IPV6 DNS4 DNS6 SERVER_PUBLIC_KEY CLIENT_PUBLIC_KEY CLIENT_PRIVATE_KEY WG_SERVER_NAME

  for ((I = 0; ; I++)); do
    ID="$I-$PEER"
    CLIENT_PRIVATE_KEY="$VAR/peer-$ID.key"

    B2="$(b2sum --binary --length 64 <<<"$ID")"
    HEX_64="${B2%% *}"
    # shellcheck disable=SC2154
    IPV6="$IPV6_NETWORK:$(perl -pe 's/(.{4})(?=.)/\1:/g' <<<"$HEX_64")/128"

    printf -v HEX_32 -- '%x' $((("0x$HEX_64" << 32 >> 32) ^ ~0xffffffff))
    printf -v IPV4_LOWER -- '%x' $(("0x$HEX_32" & ~"0x$V4_MASK" | "0x$V4_NET"))
    IPV4_OCTETS="$(perl -CAS -w -pe 's/(.{2})/0x\1 /g' <<<"$IPV4_LOWER")"
    # shellcheck disable=SC2086
    printf -v IPV4 -- '%d.%d.%d.%d/32' $IPV4_OCTETS

    if [[ -z "${SEEN["$IPV6"]:-}" ]] && [[ -z "${SEEN["$IPV4"]:-}" ]]; then
      SEEN["$IPV6"]="$ID"
      SEEN["$IPV4"]="$ID"

      DNSMAQ_HOSTS+=("${IPV4%%/*} $PEER.wg" "${IPV6%%/*} $PEER.wg")

      if [[ ! -f "$CLIENT_PRIVATE_KEY" ]]; then
        wg genkey | sponge -- "$CLIENT_PRIVATE_KEY"
      fi
      CLIENT_PRIVATE_KEY="$(<"$CLIENT_PRIVATE_KEY")"
      CLIENT_PUBLIC_KEY="$(wg pubkey <<<"$CLIENT_PRIVATE_KEY")"

      WG_LINES+=("$CLIENT_PUBLIC_KEY, $IPV6, $IPV4")

      envsubst <<<"$PEER_CONF" | sponge -- "$CACHE/$ID.conf"
      break
    fi
  done
done

IFS=$'\n'
/usr/local/libexec/m4.sh -D"ENV_IFACE=$IFACE" -D"ENV_SERVER_KEY=$SERVER_PUBLIC_KEY" | sponge -- "$NETDEV"
chmod -- g+r,o+r "$NETDEV"
printf -- '%s' "${DNSMAQ_HOSTS[@]}" | sponge -- "$DNSMASQD"
