#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

if [[ ! -t 1 ]]; then
  exec >&3

  tee <<-'EOF'
HTTP/1.0 200 OK
Content-Type: text/plain; charset=utf-8

EOF
fi

systemctl() {
  hr-run command -- systemctl --no-pager --plain --full --show-transaction "$@" || true
}

hr-run timedatectl status

systemctl --failed

systemctl list-jobs

systemctl list-timers

systemctl status
