#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail
shopt -u failglob

if [[ ! -t 1 ]]; then
  exec <&3 >&3
fi

tee -- <<- 'EOF'
HTTP/1.0 200 OK
Content-Type: text/plain; charset=utf-8

EOF

read -r -d '' -- AWK <<- 'AWK' || true
$4 { printf("%s.%s.%s.home.arpa %s\n-\n", $4, BASE, HOSTNAME, $3) }
AWK

for LEASE in /run/local/dnsmasq/*/leases; do
  DIR="${LEASE%/*}"
  BASE="${DIR##*/}"
  /usr/local/libexec/hr.sh
  sort --key 4 -- "$LEASE" | awk -v "BASE=$BASE" -v "HOSTNAME=$HOSTNAME" -- "$AWK" | column --table | sed -E -e 's/[[:space:]]+$//'
done
