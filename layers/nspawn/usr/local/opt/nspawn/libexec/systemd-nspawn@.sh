#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O globstar

set -o pipefail

MACHINE="$1"
ROOT="$2/fs"
HOSTS="$3"

CONF='/usr/local/opt/nspawn/conf.d'
HOST0="$ROOT/usr/local/lib/systemd/network/80-container-host0.network.d/0-override.conf"
LO64="$(/usr/local/opt/network/libexec/ip64alloc.sh <<<"$MACHINE")"
# shellcheck disable=2154
export -- IPV4="$IPV4_MINADDR/24" IPV6="$IPV6_NETWORK:$LO64/64"

sponge -- "$HOSTS/nspawn" <<-EOF
$IPV4 _nspawn $MACHINE
$IPV6 _nspawn $MACHINE
EOF

cat -- "$CONF"/*.nspawn "$ROOT"/*.nspawn | envsubst | sponge -- "/run/systemd/nspawn/$MACHINE.nspawn"
envsubst <"${0%/*}/../host0.network" >"$HOST0"

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
