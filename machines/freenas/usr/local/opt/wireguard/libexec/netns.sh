#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail
shopt -u failglob

ACTION="$1"
NETNS="$2"
WG_CONFS=("$3/"*.conf)
FWMARK="$4"

ETC="/etc/netns/$NETNS"
RESOLV="$ETC/resolv.conf"
WGC="$(mktemp)"

b2() {
  NAME="w-$(b3sum --no-names --length 8 <<< "$NETNS$*")"
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
  DNS_SRV=()
  for CONF in "${WG_CONFS[@]}"; do
    WG="$(b2 "$CONF")"

    DS="$(sed -E --quiet -e 's/DNS *=(.+)/\1/p' -- "$CONF")"
    readarray -t -d ',' -- DNS_SERVERS <<< "$DS"

    for DNS in "${DNS_SERVERS[@]}"; do
      readarray -t -d ' ' -- DS <<< "$DNS"
      for D in "${DS[@]}"; do
        D="${D//[[:space:]]/''}"
        if [[ -n $D ]]; then
          DNS_SRV+=("$D")
        fi
      done
    done

    sed -E -e '/^(Address|DNS|MTU).*$/d' -- "$CONF" > "$WGC"
    ip link set dev "$WG" up
    wg syncconf "$WG" "$WGC"
    wg set "$WG" fwmark "$FWMARK"

    ADDRC="$(awk -- '/Address *=/ { print $NF }' "${CONF[@]}")"
    CURRENT_ADDR="$(ip --json addr show dev "$WG" | jq --raw-output '.[].addr_info[].local')"

    declare -A -- ACC=()
    readarray -t -- ADDRESSES <<< "$ADDRC"
    readarray -t -- CURRENT <<< "$CURRENT_ADDR"

    for ADDRS in "${ADDRESSES[@]}"; do
      readarray -t -d ',' -- ADDR <<< "$ADDRS"
      for A in "${ADDR[@]}"; do
        A="${A//[[:space:]]/''}"
        if [[ -z $A ]]; then
          continue
        fi
        ACC["$A"]=1
      done
    done

    for ADDR in "${CURRENT[@]}"; do
      if [[ -n $ADDR ]] && [[ -z ${ACC["$ADDR"]:-""} ]]; then
        ip addr del "$ADDR" dev "$WG"
      fi
    done

    for ADDR in "${!ACC[@]}"; do
      ip addr replace "$ADDR" dev "$WG"
    done

    for ADDR in "${!ACC[@]}"; do
      ADDR="${ADDR//[[:space:]]/''}"
      P=4
      if [[ $ADDR =~ : ]]; then
        P=6
      fi

      ip "-$P" route replace "$ADDR" dev "$WG"
    done

    if ! ((ADDED++)); then
      PT=(4 6)
      for P in "${PT[@]}"; do
        ip "-$P" route replace default dev "$WG"
      done
    fi
  done

  if ((${#DNS_SRV[@]})); then
    for D in "${DNS_SRV[@]}"; do
      printf -- '%s\n' "nameserver $D"
    done | sponge -- "$RESOLV"
  fi
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
