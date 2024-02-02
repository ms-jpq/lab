#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O globstar

set -o pipefail

MACHINE="$1"
ROOT="$2"
HOSTS="$3"
DOMAIN="$4"

BASE="${0%/*}/.."
CONF='/usr/local/opt/nspawn/conf.d'
HOST0="$ROOT/usr/local/lib/systemd/network/10-container-host0.network"
MVLAN="$ROOT/usr/local/lib/systemd/network/10-macvlan.network"
LO64="$(/usr/local/opt/network/libexec/ip64alloc.sh <<<"$MACHINE")"

# shellcheck disable=2154
export -- IPV4="$IPV4_MINADDR" IPV6="$IPV6_NETWORK:$LO64" LO64

sponge -- "$HOSTS/nspawn" <<-EOF
$IPV4 _nspawn.$DOMAIN $MACHINE.$DOMAIN
$IPV6 _nspawn.$DOMAIN $MACHINE.$DOMAIN
EOF

cat -- "$CONF"/*.nspawn "$ROOT"/*.nspawn | envsubst | sponge -- "/run/systemd/nspawn/$MACHINE.nspawn"
IPV4="$IPV4/24" IPV6="$IPV6/64" envsubst <"$BASE/host0.network" >"$HOST0"
envsubst <"$BASE/macvlan.network" >"$MVLAN"
chmod -- o+r "$HOST0" "$MVLAN"

ARGV=(
  systemd-nspawn
  --keep-unit
  --boot
  --notify-ready yes
  -U
  # --private-users pick
  --private-users-ownership auto
  --network-veth
  --link-journal try-guest
  --settings override
  --machine "$MACHINE"
  --directory "$ROOT"
)
exec -- "${ARGV[@]}"
