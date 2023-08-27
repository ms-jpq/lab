#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

if [[ ! -t 1 ]]; then
  exec >&3

  tee <<-'EOF'
HTTP/1.0 200 OK

EOF
fi

/usr/local/bin/vmctl.sh
