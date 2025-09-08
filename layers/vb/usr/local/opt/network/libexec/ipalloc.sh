#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail
shopt -u failglob

RUN="$1"
LIB="$2"
IFACE="$3"
IPV4_PREFIX="$4"
RECORD="$RUN/$IFACE.env"

if ! [[ -v LOCKED ]]; then
  mkdir -v --parents -- "$RUN" >&2
  LOCKED=1 exec -- flock "$RUN" "$0" "$@"
fi

rm -v -fr -- "$RECORD" >&2

RS="$(ip --json -4 route | jq --raw-output '.[] | select(.dst | match("^\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}")) | .dst')"
readarray -t -- ROUTES <<< "$RS"
IS="$(ip --json -4 addr show | jq --raw-output '.[].addr_info[] | "\(.local)/\(.prefixlen)"')"
readarray -t -- INETS <<< "$IS"

IPV4_A="$(sed --regexp-extended --quiet -- 's/^IPV4_IF=(.+)$/\1/p' "$RUN"/*.env "$LIB"/*.env)"
IPV6_A="$(sed --regexp-extended --quiet -- 's/^IPV6_NETWORK=(.+)$/\1/p' "$RUN"/*.env "$LIB"/*.env)"
readarray -t -- IPV4_ALLOC <<< "$IPV4_A"
readarray -t -- IPV6_ALLOC <<< "$IPV6_A"

N=("${ROUTES[@]}" "${INETS[@]}" "${IPV4_ALLOC[@]}")
NOPE=()
for ROUTE in "${N[@]}"; do
  if [[ -n $ROUTE ]]; then
    NOPE+=("$ROUTE")
  fi
done

declare -A -- IP6ACC=()
for ROUTE in "${IPV6_ALLOC[@]}"; do
  if [[ -n $ROUTE ]]; then
    IP6ACC["$ROUTE"]=1
  fi
done

IPV4_IF="$("${0%/*}/ip4alloc.py" --verbose --no "${NOPE[@]}" -- "$IPV4_PREFIX")"
IPV4_ADDR="${IPV4_IF%%/*}"

IPV6_ULA="$("${0%/*}/ula48.sh")"
for ((i = 0; ; i++)); do
  printf -v I -- '%04x' "$i"
  IPV6_NETWORK="$IPV6_ULA:$I"
  if [[ -z ${IP6ACC["$IPV6_NETWORK"]:-""} ]]; then
    break
  fi
done
IPV6_ADDR="$IPV6_NETWORK:0000:0000:0000:0001"

IPV4_CALC="$(ipcalc-ng --json -- "$IPV4_IF")"
IPV4_MINADDR="$(jq --exit-status --raw-output '.MINADDR' <<< "$IPV4_CALC")"
IPV4_MINADDR="${IPV4_MINADDR%1}2"
IPV4_MAXADDR="$(jq --exit-status --raw-output '.MAXADDR' <<< "$IPV4_CALC")"
IPV4_NETWORK="$(jq --exit-status --raw-output '.NETWORK' <<< "$IPV4_CALC")"
IPV4_NETMASK="$(jq --exit-status --raw-output '.NETMASK' <<< "$IPV4_CALC")"

tee <<- EOF | sponge -- "$RECORD"
IPV4_IF=$IPV4_IF
IPV4_ADDR=$IPV4_ADDR
IPV4_MINADDR=$IPV4_MINADDR
IPV4_MAXADDR=$IPV4_MAXADDR
IPV4_NETWORK=$IPV4_NETWORK
IPV4_NET=$IPV4_NETWORK/$IPV4_PREFIX
IPV4_NETMASK=$IPV4_NETMASK
IPV4_PREFIX=$IPV4_PREFIX
IPV6_IF=$IPV6_ADDR/64
IPV6_ADDR=$IPV6_ADDR
IPV6_NETWORK=$IPV6_NETWORK
IPV6_NET=$IPV6_NETWORK:0000:0000:0000:0000/64
IPV48_NETWORK=$IPV6_ULA
IPV48_NET=${IPV6_ULA}:0000:0000:0000:0000:0000/48
EOF

exec -- cat -- "$RECORD"
