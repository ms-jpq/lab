#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

if [[ ! -t 1 ]]; then
  exec >&3

  tee <<-'EOF'
HTTP/1.0 200 OK
Content-Type: text/plain; charset=utf-8

EOF
fi

hr-run networkctl status
hr-run resolvectl status
hr-run resolvectl statistics
hr-run ip addr
hr-run ip -6 route
hr-run ip -4 route
