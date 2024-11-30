#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

if [[ ! -t 1 ]]; then
  exec <&3 >&3
fi

HOST="$HOSTNAME"
while read -r LINE; do
  LINE="${LINE%$'\r'}"
  if [[ -z $LINE ]]; then
    break
  fi

  LHS="${LINE%%:*}"
  KEY="${LHS,,}"
  case "$KEY" in
  host)
    HOST="${LINE##*: }"
    ;;
  *) ;;
  esac
done

tee -- <<- 'EOF'
HTTP/1.0 200 OK
Content-Type: text/plain; charset=utf-8

EOF

/usr/local/libexec/hr-run.sh cat -- /etc/rancher/k3s/k3s.yaml | sed -E -e '2a---' -e "s#https://\[::\]:6443#https://$HOST:6443#g"
/usr/local/libexec/hr-run.sh systemctl --no-pager --full --lines 0 status -- 0-k3s.service
/usr/local/libexec/hr-run.sh systemctl --no-pager --full --lines 0 status -- kubepods.slice
