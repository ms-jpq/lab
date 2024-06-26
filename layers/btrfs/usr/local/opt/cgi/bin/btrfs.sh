#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

if [[ ! -t 1 ]]; then
  exec <&3 >&3
fi

tee -- <<- 'EOF'
HTTP/1.0 200 OK
Content-Type: text/plain; charset=utf-8

EOF

FS="$(df --type btrfs --output=target | sed -E -e '1d')"
readarray -t -- LINES <<< "$FS"

/usr/local/libexec/hr-run.sh btrfs filesystem show --si

for LINE in "${LINES[@]}"; do
  printf -- '\n'
  /usr/local/libexec/hr.sh '@'
  printf -- '\n'
  /usr/local/libexec/hr-run.sh btrfs device stats -- "$LINE"
  printf -- '\n'
  /usr/local/libexec/hr-run.sh btrfs filesystem df --si -- "$LINE"
  printf -- '\n'
  /usr/local/libexec/hr-run.sh btrfs scrub status --si -- "$LINE"
  printf -- '\n'
  /usr/local/libexec/hr-run.sh btrfs subvolume list -o --sort path -- "$LINE" | sed -E -e 's/^ID .+ path //'
  printf -- '\n'
done
