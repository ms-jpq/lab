#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O globstar

set -o pipefail

MACHINE="$1"
ROOT="$2"

CONF='/usr/local/opt/nspawn/conf.d'
cat -- "$CONF"/*.nspawn "$ROOT"/*.nspawn | envsubst | sponge -- "/run/systemd/nspawn/$MACHINE.nspawn"
ARGV=(
  systemd-nspawn
  --keep-unit
  --boot
  --notify-read yes
  -U
  --network-veth
  --link-journal try-guest
  --settings override
  --machine "$MACHINE"
  --directory "$ROOT/fs"
)
exec -- "${ARGV[@]}"
