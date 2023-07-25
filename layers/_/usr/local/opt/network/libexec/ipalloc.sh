#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

RUN='/run/ipv4'
ALLOC="$RUN/alloc"

if ! [[ -v LOCKED ]]; then
  mkdir --parents -- "$ALLOC"
  LOCKED=1 exec -- flock "$RUN/local/lock" "$0" "$@"
fi

cd -- "${0%/*}"

IFACE="$1"
RECORD="$ALLOC/$IFACE"
shift

rm --force --recursive -- "$RECORD"
RS="$(ip --json -4 route | jq --exit-status --raw-output '.[] | select(.dst | match("^\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}")) | .dst')"
readarray -t -d $'\n' -- ROUTES <<<"$RS"
IS="$(ip --json -4 addr show | jq --exit-status --raw-output '.[] | .addr_info[] | "\(.local)/\(.prefixlen)"')"
readarray -t -d $'\n' -- INETS <<<"$IS"

SEEN=()
for A in "$ALLOC"/*; do
  readarray -t -d $'\n' -- SAW <"$A"
  SEEN+=("${SAW[@]}")
done

./ipcalc.py --verbose --no "${ROUTES[@]}" "${INETS[@]}" "${SEEN[@]}" -- "$@" | sponge -- "$RECORD"
exec -- cat -- "$RECORD"
