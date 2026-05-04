#!/usr/bin/env -S -- bash -Eeu -o pipefail -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

GIXY='/opt/python3/gixy'
PYTHONPATH="$GIXY" exec -- /usr/local/libexec/hr-run.sh "$GIXY/bin/gixy" -- /usr/local/opt/nginx/conf/main.nginx
