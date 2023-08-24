#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

IFACE="$1"
DUMP="$1"

IFACE='vn-wg'
RUN='/run/systemd/network'
VAR='/var/lib/wireguard'
SERVER_PRIVATE_KEY="$VAR/self.key"

export -- IPV4 IPV6 DNS4 DNS6 SERVER_PUBLIC_KEY CLIENT_PUBLIC_KEY CLIENT_PRIVATE_KEY WG_SERVER_NAME

SERVER_PUBLIC_KEY="$(wg pubkey <"$SERVER_PRIVATE_KEY")"
ULA="$(/usr/local/lib/network/ula.sh "$IFACE")"
IPV4="$(<"/run/ipv4/alloc/$IFACE")"
DNS4="${IPV4%%/*}"
DNS6="$ULA::1"
IPV6="$DNS6/64"

mkdir --parents -- "$RUN" "$VAR" "$DUMP"
rm --force --recursive -- "${DUMP:?}"/*

TMP_HOSTS="$(mktemp)"
TMP_NETDEV="$(mktemp)"
TMP_NETWORK="$(mktemp)"

envsubst <./vn-wg@.netdev >"$TMP_NETDEV"
envsubst <./vn-wg@.network >"$TMP_NETWORK"

PEER_CONF="$(<./wg-peer.conf)"
PEER_TEMPLATE="$(<./vn-wg-peer@.netdev)"

readarray -t -d $'\n' -- PEERS < <(sort <<<"${WG_PEERS// /$'\n'}")

declare -A -- SEEN
readarray -t -d $'\n' -- IP4_INFO < <(ipcalc-ng --json -- "$IPV4" | jq --raw-output '.MINADDR, .BROADCAST, .NETWORK, .NETMASK')
SEEN=(
  ["${IP4_INFO[0]}/32"]=1
  ["${IP4_INFO[1]}/32"]=1
)

# shellcheck disable=SC2086
printf -v V4_NET -- '%02x' ${IP4_INFO[2]//./ }
# shellcheck disable=SC2086
printf -v MASK -- '%02x' ${IP4_INFO[3]//./ }

for PEER in "${PEERS[@]}"; do
  PEER="${PEER%%$'\n'}"

  for ((I = 0; ; I++)); do
    ID="$I-$PEER"
    CLIENT_PRIVATE_KEY="$VAR/peer-$ID.key"

    readarray -t -d ' ' -- B2 < <(b2sum --binary --length 64 <<<"$ID")
    HEX_64="${B2[0]}"
    printf -v HEX_32 -- '%x' $((("0x$HEX_64" << 32 >> 32) ^ ~0xffffffff))

    ADDR="$ULA:$(perl -pe 's/(.{4})(?=.)/\1:/g' <<<"$HEX_64")"
    IPV6="$ADDR/128"

    printf -v ADDR -- '%x' $(("0x$HEX_32" & ~"0x$MASK" | "0x$V4_NET"))
    # shellcheck disable=SC2183,SC2046
    IPV4="$(printf -- '%d.%d.%d.%d' $(perl -pe 's/(.{2})/0x\1 /g' <<<"$ADDR"))/32"

    if [[ -z "${SEEN["$IPV6"]:-}" ]] && [[ -z "${SEEN["$IPV4"]:-}" ]]; then
      SEEN["$IPV6"]="$ID"
      SEEN["$IPV4"]="$ID"

      printf -- '%s\n' "${IPV4%%/*} $PEER.wg" >>"$TMP_HOSTS"
      printf -- '%s\n' "${IPV6%%/*} $PEER.wg" >>"$TMP_HOSTS"

      if [[ ! -f "$CLIENT_PRIVATE_KEY" ]]; then
        wg genkey | sponge -- "$CLIENT_PRIVATE_KEY"
      fi
      CLIENT_PRIVATE_KEY="$(<"$CLIENT_PRIVATE_KEY")"
      CLIENT_PUBLIC_KEY="$(wg pubkey <<<"$CLIENT_PRIVATE_KEY")"

      envsubst <<<"$PEER_CONF" | sponge -- "$DUMP/$ID.conf"
      break
    fi
  done

  envsubst <<<"$PEER_TEMPLATE" >>"$TMP_NETDEV"
done

chmod -- g+r,o+r "$TMP_NETDEV" "$TMP_NETWORK" "$TMP_HOSTS"
mv --force -- "$TMP_NETDEV" "$RUN/00-vn-wg.netdev"
mv --force -- "$TMP_NETWORK" "$RUN/00-vn-wg.network"
mv --force -- "$TMP_HOSTS" "/run/wireguard/dnsmasq.d/hosts"

networkctl reload
networkctl reconfigure -- vn-wg
