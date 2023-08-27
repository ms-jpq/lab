#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

if [[ ! -t 1 ]]; then
  exec >&3
fi

tee -- <<-'EOF'
HTTP/1.0 200 OK
Content-Type: text/plain; charset=utf-8

EOF

/usr/local/libexec/hr-run.sh zpool status -v -s -t -i -T d
/usr/local/libexec/hr-run.sh zpool iostat -v -l -T d
/usr/local/libexec/hr-run.sh zfs list -o name,mountpoint,used,volsize,available
/usr/local/libexec/hr-run.sh zfs list -t snapshot -o name,creation,used | awk '$NF != "0B" { print }'
