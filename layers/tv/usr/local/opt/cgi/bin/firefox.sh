#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

if [[ ! -t 1 ]]; then
  exec <&3 >&3
fi

BYTES=0
while read -r LINE; do
  LINE="${LINE%%$'\r'}"
  if [[ -z "$LINE" ]]; then
    break
  fi

  LHS="${LINE%%:*}"
  KEY="${LHS,,}"
  case "$KEY" in
  content-length)
    BYTES="${LINE##*: }"
    ;;
  *) ;;
  esac
done

URI="$(head --bytes "$BYTES" | jq --exit-status --raw-output '.uri')"
NAME="$(systemd-escape -- "$URI")"

tee <<-'EOF'
HTTP/1.0 200 OK
Content-Type: text/plain; charset=utf-8

EOF

exec -- systemctl --user --machine 1000@.host --no-block start -- "6-firefox@$NAME.service"
