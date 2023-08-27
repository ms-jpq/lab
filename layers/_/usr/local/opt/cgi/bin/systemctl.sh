#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

if [[ ! -t 1 ]]; then
  exec >&3
fi

tee -- <<-'EOF'
HTTP/1.0 200 OK
Content-Type: text/plain; charset=utf-8

EOF

systemctl() {
  /usr/local/libexec/hr-run.sh systemctl --no-pager --plain --full --show-transaction "$@" || true
}

/usr/local/libexec/hr-run.sh timedatectl status

systemctl --failed

systemctl list-jobs

systemctl list-timers

systemctl status
