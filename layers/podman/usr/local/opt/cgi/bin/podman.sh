#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

if [[ ! -t 1 ]]; then
  exec >&3
fi

tee -- <<-'EOF'
HTTP/1.0 200 OK
Content-Type: text/plain; charset=utf-8

EOF

NAME="${0##*/}"

if [[ "$NAME" == "docker.sh" ]]; then
  /usr/local/libexec/hr-run.sh systemctl --no-pager --full --lines 0 status -- docker.slice
fi

NAME="${NAME%.sh}"

/usr/local/libexec/hr-run.sh "$NAME" image ls --all
/usr/local/libexec/hr-run.sh "$NAME" network ls
/usr/local/libexec/hr-run.sh "$NAME" ps --all
/usr/local/libexec/hr-run.sh "$NAME" volume ls
