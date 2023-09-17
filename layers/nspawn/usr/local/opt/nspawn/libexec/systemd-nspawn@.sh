#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

MACHINE="$1"
ROOT="$2"

"${0%/*}/apriori.sh" "$MACHINE" "$ROOT"
CONF='/usr/local/opt/nspawn/conf.d'
cat -- "$CONF"/*.nspawn | envsubst | sponge -- "/run/systemd/nspawn/$MACHINE.nspawn"
exec -- systemd-nspawn --keep-unit --boot --notify-read=yes -U --network-veth --link-journal=try-guest --settings=override --machine="$MACHINE" --directory="$ROOT/fs"
