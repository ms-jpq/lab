#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

if [[ ! -t 1 ]]; then
  exec >&3

  tee <<-'EOF'
HTTP/1.0 200 OK
Content-Type: text/plain; charset=utf-8

EOF
fi

hr-run zpool status -v -s -t -i -T d
hr-run zpool iostat -v -l -T d
hr-run zfs list -o name,mountpoint,used,volsize,available
hr-run zfs list -t snapshot -o name,creation,used | awk '$NF != "0B" { print }'
