#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail
shopt -u failglob

IFACE="$1"
DOMAIN="$2"
NETDEV="$3"
DNSMASQD="$4"
CACHE="$5"
VAR="$6"
SERVER_NAME="$7"
WG_PEERS="$8"

SYSTEMD='/run/systemd/network'
SELF="${0%/*}/.."
SERVER_PRIVATE_KEY="$VAR/self.key"

mkdir -v --parents -- "$SYSTEMD" "$VAR" "$CACHE"
SERVER_PUBLIC_KEY="$(wg pubkey < "$SERVER_PRIVATE_KEY")"
rm -v --force --recursive -- "${CACHE:?}"/*

# shellcheck disable=SC2086,SC2154
printf -v V4_NET -- '%02x' ${IPV4_NETWORK//./ }
# shellcheck disable=SC2086,SC2154
printf -v V4_MASK -- '%02x' ${IPV4_NETMASK//./ }

declare -A -- SEEN
SEEN=(
  ["$IPV4_MINADDR/$IPV4_PREFIX"]=1
  ["$IPV4_MAXADDR/$IPV4_PREFIX"]=1
)

WG_IDS=()
WG_LINES=()
DNSMAQ_HOSTS=()

export -- DOMAIN IPV6 IPV4 SERVER_PUBLIC_KEY SERVER_NAME CLIENT_PRIVATE_KEY CLIENT_SHARED_KEY
# shellcheck disable=SC2154
MACHINE_ULA="$IPV48_NET"

P="$(sort --unique --field-separator ',' <<< "$WG_PEERS")"
readarray -t -d ',' -- PEERS <<< "$P"
for PEER in "${PEERS[@]}"; do
  PEER="$(printf -- '%s' "${PEER//[[:space:]]/''}" | jq --slurp --raw-input --raw-output '@uri')"
  if [[ -z $PEER ]]; then
    continue
  fi

  # shellcheck disable=SC2154
  IPV6="$IPV6_NETWORK:$(b3sum --no-names --length 8 <<< "$PEER" | perl -CASD -wpe 's/(.{4})(?=.)/$1:/g')/48"

  for ((I = 0; ; I++)); do
    ID="$I-$PEER"
    CIFACE="w-$HOSTNAME"
    CLIENT_PRIVATE_KEY="$VAR/peer-$ID.key"
    CLIENT_SHARED_KEY="$VAR/peer-$ID.psk"

    B3="0x$(b3sum --no-names --length 4 <<< "$ID")"
    printf -v HEX_32 -- '%08x' $((B3 & ~"0x$V4_MASK" | "0x$V4_NET"))

    IPV4_OCTETS="$(perl -CASD -wpe 's/(.{2})/0x$1 /g' <<< "$HEX_32")"
    # shellcheck disable=SC2086
    printf -v IPV4 -- '%d.%d.%d.%d' $IPV4_OCTETS
    IPV4="$IPV4/$IPV4_PREFIX"

    if [[ -z ${SEEN["$IPV6"]:-} ]] && [[ -z ${SEEN["$IPV4"]:-} ]]; then
      SEEN["$IPV6"]="$ID"
      SEEN["$IPV4"]="$ID"
      WG_IDS+=("$ID")
      DNSMAQ_HOSTS+=("${IPV4%%/*} $PEER.wg" "${IPV6%%/*} $PEER.wg")

      if [[ ! -f $CLIENT_PRIVATE_KEY ]]; then
        wg genkey | sponge -- "$CLIENT_PRIVATE_KEY"
      fi
      if [[ ! -f $CLIENT_SHARED_KEY ]]; then
        wg genpsk | sponge -- "$CLIENT_SHARED_KEY"
      fi

      CLIENT_PRIVATE_KEY="$(< "$CLIENT_PRIVATE_KEY")"
      CLIENT_PUBLIC_KEY="$(wg pubkey <<< "$CLIENT_PRIVATE_KEY")"
      CLIENT_SHARED_KEY="$(< "$CLIENT_SHARED_KEY")"

      WG_LINES+=("[$ID, $CLIENT_PUBLIC_KEY, $CLIENT_SHARED_KEY, ${IPV6%%/*}/128, ${IPV4%%/*}/32]")

      CONF="$(envsubst < "$SELF/peer.conf")"
      QR="$(qrencode --type utf8 <<< "$CONF")"
      {
        readarray -t -- LINES <<< "$QR"
        printf -- '%s\n\n\n' "$CONF"
        for LINE in "${LINES[@]}"; do
          printf -- '%s\n' "# $LINE"
        done
      } | sponge -- "$CACHE/$ID.txt"

      HTML_TITLE="$ID" HTML_PRE="$CONF" HTML_CODE="$QR" envsubst < "$SELF/peer.html" | sponge -- "$CACHE/$ID.html"
      # shellcheck disable=SC2154
      IFACE="$CIFACE" IPV6_IF="$MACHINE_ULA" IPV4_IF="$IPV4_NET" envsubst < "$SELF/peer.netdev" | sponge -- "$CACHE/$ID.netdev"
      IPV6_IF="$IPV6" IPV4_IF="$IPV4" IFACE="$CIFACE" DOMAIN="$HOSTNAME.home.arpa" envsubst < "$SELF/@.network" | sponge -- "$CACHE/$ID.network"
      break
    fi
  done
done

IFS=$'\n'
sponge -- "$DNSMASQD" <<< "${DNSMAQ_HOSTS[*]}"
IFS=','
/usr/local/libexec/m4.sh -D"ENV_IFACE=$IFACE" -D"ENV_SERVER_KEY=$SERVER_PRIVATE_KEY" -D"ENV_PEER=${WG_LINES[*]}" "$SELF/@.netdev" | sponge -- "$NETDEV"
/usr/local/libexec/m4.sh -D"ENV_TITLE=$IFACE" -D"ENV_PEER=${WG_IDS[*]}" "$SELF/index.html" | sponge -- "$CACHE/index.html"
chmod -- g+r,o+r "$NETDEV"
