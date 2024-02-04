#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

if [[ -f /.dockerenv ]]; then
  exit 0
fi

exec -- smbcontrol --configfile=/usr/local/opt/samba/smb.conf "$@"
