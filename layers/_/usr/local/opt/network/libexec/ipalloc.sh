#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O globstar

set -o pipefail

RUN="$1"
IFACE="$2"
SUBNET="$3"
RECORD="$RUN/$IFACE.env"

if ! [[ -v LOCKED ]]; then
  mkdir -v --parents -- "$RUN" >&2
  LOCKED=1 exec -- flock "$RUN" "$0" "$@"
fi

rm -v -fr -- "$RECORD" >&2

RS="$(ip --json -4 route | jq --exit-status --raw-output '.[] | select(.dst | match("^\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}")) | .dst')"
readarray -t -- ROUTES <<<"$RS"
IS="$(ip --json -4 addr show | jq --exit-status --raw-output '.[].addr_info[] | "\(.local)/\(.prefixlen)"')"
readarray -t -- INETS <<<"$IS"

SEEN=()
for A in "$RUN"/*.env; do
  read -r -- LINE <"$A" || true
  LINE="${LINE#*=}"
  SEEN+=("$LINE")
done

IPV4_IF="$("${0%/*}/ip4alloc.py" --verbose --no "${ROUTES[@]}" "${INETS[@]}" "${SEEN[@]}" -- "$SUBNET")"
IPV4_ADDR="${IPV4_IF%%/*}"
IPV6_NETWORK="$("${0%/*}/ula64.sh" "$IFACE")"
IPV6_ADDR="$IPV6_NETWORK:0000:0000:0000:0001"

IPV4_CALC="$(ipcalc-ng --json -- "$IPV4_IF")"
IPV4_MINADDR="$(jq --exit-status --raw-output '.MINADDR' <<<"$IPV4_CALC")"
IPV4_MINADDR="${IPV4_MINADDR%1}2"
IPV4_MAXADDR="$(jq --exit-status --raw-output '.MAXADDR' <<<"$IPV4_CALC")"
IPV4_NETWORK="$(jq --exit-status --raw-output '.NETWORK' <<<"$IPV4_CALC")"
IPV4_NETMASK="$(jq --exit-status --raw-output '.NETMASK' <<<"$IPV4_CALC")"

tee <<-EOF | sponge -- "$RECORD"
IPV4_IF=$IPV4_IF
IPV4_ADDR=$IPV4_ADDR
IPV4_MINADDR=$IPV4_MINADDR
IPV4_MAXADDR=$IPV4_MAXADDR
IPV4_NETWORK=$IPV4_NETWORK
IPV4_NETMASK=$IPV4_NETMASK
IPV6_IF=$IPV6_ADDR/64
IPV6_ADDR=$IPV6_ADDR
IPV6_NETWORK=$IPV6_NETWORK
EOF

exec -- cat -- "$RECORD"
