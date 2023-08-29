#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

PORT='8080'
if [[ -t 0 ]]; then
  printf -- '%q ' curl -v -- localhost:"$PORT"
  printf -- '\n'
  exec -- socat TCP-LISTEN:"$PORT",reuseaddr,fork EXEC:"$0"
fi

tee <<-EOF
HTTP/1.1 200 OK

EOF

printf -- '%s\n' 'hello!' >&2
exec -- cat -- "$0"
