#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O globstar

set -o pipefail

ACTION="$1"
NETNS="$2"
WG_CONFS=("$3/"*.conf)
FWMARK="$4"

ETC="/etc/netns/$NETNS"
RESOLV="$ETC/resolv.conf"
WGC="$(mktemp)"

b2() {
  B2="$(b2sum --binary --length 64 <<<"$NETNS$*")"
  B2="${B2% *}"
  NAME="w-$B2"
  printf -- '%s' "${NAME::15}"
}

up() {
  for CONF in "${WG_CONFS[@]}"; do
    WG="$(b2 "$CONF")"
    ip link add dev "$WG" type wireguard
    ip link set dev "$WG" netns "$NETNS"
  done
}

down() {
  for CONF in "${WG_CONFS[@]}"; do
    WG="$(b2 "$CONF")"
    ip --netns "$NETNS" link del dev "$WG" type wireguard || true
    ip link del dev "$WG" type wireguard || true
  done
}

reload() {
  declare -A -- ACC
  ADDED=0
  for CONF in "${WG_CONFS[@]}"; do
    WG="$(b2 "$CONF")"

    DS="$(sed -E --quiet 's/DNS =(.+)/\1/p' "$CONF")"
    readarray -t -d ',' -- DNS_SERVERS <<<"$DS"

    for DNS in "${DNS_SERVERS[@]}"; do
      readarray -t -d ' ' -- DS <<<"$DNS"
      for D in "${DS[@]}"; do
        D="${D//[[:space:]]/''}"
        if [[ -n "$D" ]]; then
          printf -- '%s\n' "nameserver $D"
        fi
      done

    done | sponge -- "$RESOLV"

    sed -E '/^(Address|DNS) .*/d' -- "$CONF" >"$WGC"
    ip link set dev "$WG" up
    wg syncconf "$WG" "$WGC"
    wg set "$WG" fwmark "$FWMARK"

    ADDRC="$(awk '/Address =/ { print $NF }' "${CONF[@]}")"
    CURRENT_ADDR="$(ip --json addr show dev "$WG" | jq --raw-output '.[].addr_info[].local')"

    declare -A -- ACC=()
    readarray -t -- ADDRESSES <<<"$ADDRC"
    readarray -t -- CURRENT <<<"$CURRENT_ADDR"

    for ADDRS in "${ADDRESSES[@]}"; do
      readarray -t -d ',' -- ADDR <<<"$ADDRS"
      for A in "${ADDR[@]}"; do
        A="${A//[[:space:]]/''}"
        ACC["$A"]=1
      done
    done

    for ADDR in "${CURRENT[@]}"; do
      if [[ -n "$ADDR" ]] && [[ -z "${ACC["$ADDR"]:-""}" ]]; then
        ip addr del "$ADDR" dev "$WG"
      fi
    done

    for ADDR in "${!ACC[@]}"; do
      ip addr replace "$ADDR" dev "$WG"
    done

    for ADDR in "${!ACC[@]}"; do
      ADDR="${ADDR//[[:space:]]/''}"
      P=4
      if [[ "$ADDR" =~ : ]]; then
        P=6
      fi

      ip "-$P" route add "$ADDR" dev "$WG"
    done

    if ! ((ADDED++)); then
      PT=(4 6)
      for P in "${PT[@]}"; do
        ip "-$P" route add default dev "$WG"
      done
    fi
  done
}

case "$ACTION" in
up)
  up
  ;;
reload)
  if [[ -v UNDER ]]; then
    reload
  else
    UNDER=1 ip netns exec "$NETNS" "$0" "$@"
  fi
  ;;
down)
  down
  ;;
*)
  set -x
  exit 1
  ;;
esac
