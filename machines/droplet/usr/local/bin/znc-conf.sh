#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

exec -- runuser --user _znc -- znc --makeconf --datadir /var/lib/local/znc
