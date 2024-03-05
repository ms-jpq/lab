#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

if [[ ! -t 1 ]]; then
  exec >&3
fi

tee -- <<-'EOF'
HTTP/1.0 200 OK
Content-Type: text/plain; charset=utf-8

EOF

for _ in {0..6}; do
  /usr/local/libexec/hr-run.sh zpool iostat -y -v -l -L -- 1 1
  printf -- '\n'
done
