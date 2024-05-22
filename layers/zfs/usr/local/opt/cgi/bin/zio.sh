#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

if [[ ! -t 1 ]]; then
  exec <&3 >&3
fi

tee -- <<- 'EOF'
HTTP/1.0 200 OK
Content-Type: text/plain; charset=utf-8

EOF

{
  printf -- '%s ' -v -l -L -- 1 1
  printf -- '\n'
  printf -- '%s ' -w -L -- 1 1
} | sed -E -e 's/ $//' | parallel --quote --colsep ' ' --keep-order -- /usr/local/libexec/hr-run.sh zpool iostat -y
