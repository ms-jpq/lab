#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

if [[ ! -t 1 ]]; then
  exec >&3

  tee <<-'EOF'
HTTP/1.0 200 OK
Content-Type: text/html; charset=utf-8

EOF
fi

TITLE="$(basename -- "$0")"
read -r -d '' -- BODY <<-EOF || true
<hr>
  <a href="/wg.sh/wireguard">wireguard</a>
  <hr>
  <pre>$(networkctl status -- vn-wg 2>&1)</pre>
  <hr>
  <pre>$(wg show 2>&1)</pre>
<hr>
EOF

export -- TITLE BODY
envsubst </usr/local/lib/nginx/index.html
