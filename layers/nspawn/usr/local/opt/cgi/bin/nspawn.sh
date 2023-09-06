#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O globstar

set -o pipefail

if [[ ! -t 1 ]]; then
  exec >&3
fi

tee -- <<-'EOF'
HTTP/1.0 200 OK
Content-Type: text/plain; charset=utf-8

EOF

/usr/local/bin/nspawnctl.sh
