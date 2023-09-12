#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

IF='nordlynx'
A="$(ip --json addr show dev "$IF" | jq --exit-status --raw-output '.[].addr_info[] | "\(.local)/\(.prefixlen)"' | sed -E -n 's/(.+)/Address = \1/p')"
readarray -t -- ADDRS <<<"$A"

# TODO -- next version of resolvctl supports JSON

D="$(resolvectl dns -- "$IF")"
D="${D#*':'}"
readarray -t -d ' ' -- DNS <<<"$D"

SD='/^$/i'
SED=()
for A in "${ADDRS[@]}"; do
  SED+=(-e "$SD$A")
done
for D in "${DNS[@]}"; do
  if [[ -n "$D" ]]; then
    SED+=(-e "${SD}DNS = $D")
  fi
done

IFS=$'\n'
CONF="$(wg showconf "$IF" | sed -E "${SED[@]}")"
printf -- '%s\n' "$CONF"
