#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

if [[ ! -t 1 ]]; then
  exec <&3 >&3
fi

tee -- <<- 'EOF'
HTTP/1.0 200 OK
Content-Type: text/plain; charset=utf-8

EOF

HR='/usr/local/libexec/hr-run.sh'

"$HR" xray api statsquery -server 127.0.0.53:29999
"$HR" xray api statsquery -server 127.0.0.1:39999
"$HR" jq --exit-status --sort-keys < /usr/local/opt/xray/client.json
