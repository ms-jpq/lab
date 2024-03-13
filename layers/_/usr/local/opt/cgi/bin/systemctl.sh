#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

if [[ ! -t 1 ]]; then
  exec <&3 >&3
fi

tee -- <<-'EOF'
HTTP/1.0 200 OK
Content-Type: text/plain; charset=utf-8

EOF

/usr/local/libexec/hr-run.sh timedatectl status

AS=(
  --failed
  list-jobs
  list-timers
  list-sockets
  list-machines
)

for A in "${AS[@]}"; do
  /usr/local/libexec/hr-run.sh systemctl --no-pager --all --full --show-types --show-transaction "$A"
done

/usr/local/libexec/hr-run.sh systemctl --no-pager --full --show-transaction list-dependencies
