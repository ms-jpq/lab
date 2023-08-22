#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O globstar

set -o pipefail

if [[ ! -t 1 ]]; then
  exec >&3

  tee <<-'EOF'
HTTP/1.0 200 OK
Content-Type: text/html; charset=utf-8

EOF

  read -r -u 3 -- LINE
  readarray -t -d ' ' -- PARTS <<<"$LINE"
  URI="${PARTS[1]}"
  MACHINE="${URI##'/'}"
  MACHINE="${MACHINE%%'/'*}"
  MACHINE="${MACHINE%%'.nspawn'}"
else
  MACHINE="${1:-}"
fi

SOCKS='/run/nspawn-sockets/'
machines() {
  for SOCK in "$SOCKS"*@22.sock; do
    MACHINE="${SOCK##"$SOCKS"}"
    MACHINE="${MACHINE%%'@22.sock'}"
    printf -- '%s' "<li><a href=\"$MACHINE\">$MACHINE</a></li>"
  done
}

TITLE="$(basename -- "$0")"
if [[ -z "$MACHINE" ]]; then
  read -r -d '' -- BODY <<-EOF || true
<hr>
  <ul>$(machines)</ul>
<hr>
  <pre>$(nspawnctl.sh 2>&1)</pre>
<hr>
EOF

else
  read -r -d '' -- BODY <<-EOF || true
<hr>
  <pre>$(nspawnctl.sh status -- "$MACHINE" 2>&1)</pre>
<hr>
EOF
fi

export -- TITLE BODY
envsubst </usr/local/lib/nginx/index.html
