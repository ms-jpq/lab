#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

RUN="$1"
IFACE="$2"
RECORD="$RUN/$IFACE"

if ! [[ -v LOCKED ]]; then
  mkdir -v --parents -- "$RUN"
  LOCKED=1 exec -- flock "$RUN" "$0" "$@"
else
  shift -- 2
fi

cd -- "${0%/*}"

rm -v -fr -- "$RECORD"

RS="$(ip --json -4 route | jq --exit-status --raw-output '.[] | select(.dst | match("^\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}")) | .dst')"
readarray -t -- ROUTES <<<"$RS"
IS="$(ip --json -4 addr show | jq --exit-status --raw-output '.[].addr_info[] | "\(.local)/\(.prefixlen)"')"
readarray -t -- INETS <<<"$IS"

SEEN=()
for A in "$RUN"/*; do
  readarray -t -n 1 -- LS <"$A"
  for LINE in "${LS[@]}"; do
    LINE="${LINE#*=}"
    readarray -t -d ',' -- SAW <<<"$LINE"
    SEEN+=("${SAW[@]}")
  done
done

N="$(./ipcalc.py --verbose --no "${ROUTES[@]}" "${INETS[@]}" "${SEEN[@]}" -- "$@")"
readarray -t -- IPV4_IF <<<"$N"

IPV4_ADDR=()
for IF in "${IPV4_IF[@]}"; do
  IP="${IF%%/*}"
  IPV4_ADDR+=("$IP")
  IPV4_IF+=("$IF")
done

IFS=','
LINE1="IPV4_IF=${IPV4_IF[*]}"
LINE2="IPV4_ADDR=${IPV4_ADDR[*]}"
unset -- IFS

printf -- '%s\n' "$LINE1" "$LINE2" | sponge -- "$RECORD"
exec -- cat -- "$RECORD"
