#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

if [[ ! -t 1 ]]; then
  exec <&3 >&3
fi

tee -- <<- 'EOF'
HTTP/1.0 200 OK
Content-Type: text/plain; charset=utf-8

EOF

export -- K3S_DATA_DIR=/var/lib/k3s/data
/usr/local/libexec/hr-run.sh k3s kubectl get --all-namespaces all
/usr/local/libexec/hr-run.sh systemctl --no-pager --full --lines 0 status -- 0-k3s.service
/usr/local/libexec/hr-run.sh systemctl --no-pager --full --lines 0 status -- kubepods.slice
/usr/local/libexec/hr-run.sh cat -- /var/lib/k3s/kubeconfig.yml
