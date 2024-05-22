#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

if [[ ! -t 1 ]]; then
  exec <&3 >&3
fi

tee -- <<- 'EOF'
HTTP/1.0 200 OK
Content-Type: text/plain; charset=utf-8

EOF

/usr/local/libexec/hr-run.sh networkctl
/usr/local/libexec/hr-run.sh ip addr
/usr/local/libexec/hr-run.sh networkctl status --all
