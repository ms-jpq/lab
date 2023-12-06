#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

cd -- "${0%/*}"

PORT='49153'

XML=(
  xmlstarlet edit
  -N 'x=http://mediatomb.cc/config/2'
  --update '/x:config/x:server/x:ui/@enabled' --value 'yes'
  # --update '/x:config/x:server/x:home' --value '/var/lib/local/gerbera'
  # --subnode '/x:config/x:server' --type elem --name 'interface' --value '!lo'
  --subnode '/x:config/x:server' --type elem --name 'port' --value "$PORT"
  --subnode '/x:config/x:server' --type elem --name 'virtualURL' --value "http://localhost:$PORT"
  --subnode '/x:config/x:server' --type elem --name 'pc-directory'
  --subnode '/x:config/x:server/pc-directory' --type attr --name 'upnp-hide' --value 'no'
)

exec -- "${XML[@]}" "$@"
