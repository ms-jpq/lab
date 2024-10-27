#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

if [[ ! -t 1 ]]; then
  exec <&3 >&3
fi

tee -- <<- 'EOF'
HTTP/1.0 200 OK
Content-Type: text/plain; charset=utf-8

EOF

/usr/local/libexec/hr-run.sh cat -- /var/lib/local/k3s/kubeconfig.yml
/usr/local/libexec/hr-run.sh systemctl --no-pager --full --lines 0 status -- 0-k3s.service
/usr/local/libexec/hr-run.sh systemctl --no-pager --full --lines 0 status -- kubepods.slice
