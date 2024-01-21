#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

if [[ ! -t 1 ]]; then
  exec >&3

fi

tee -- <<-'EOF'
HTTP/1.0 200 OK
Content-Type: text/plain; charset=utf-8

EOF

/usr/local/libexec/hr-run.sh tree --dirsfirst -F -a -L 3 -- /var/lib/local/qemu
/usr/local/libexec/hr-run.sh systemctl --no-pager status --lines 0 -- '2-qemu-microvm@*.service' || true
/usr/local/libexec/hr-run.sh systemctl --no-pager status --lines 0 -- '2-qemu-q35@*.service' || true
