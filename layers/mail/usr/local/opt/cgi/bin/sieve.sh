#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

if [[ ! -t 1 ]]; then
  exec <&3 >&3
fi

while read -r LINE; do
  LINE="${LINE%%$'\r'}"
  if [[ -z $LINE ]]; then
    break
  fi

  # printf -- '%s\n' "$LINE" >&2

  LHS="${LINE%%:*}"
  KEY="${LHS,,}"
  case "$KEY" in
  auth-protocol)
    AUTH_PROTOCOL="${LINE##*: }"
    ;;
  client-ip)
    CLIENT_IP="${LINE##*: }"
    ;;
  auth-user)
    AUTH_USER="${LINE##*: }"
    ;;
  auth-pass)
    AUTH_PASS="${LINE##*: }"
    ;;
  *) ;;
  esac
done

case "$AUTH_PROTOCOL" in
smtp)
  exec -- tee -- <<- 'EOF'
HTTP/1.0 200 OK
Auth-Status: OK
Auth-Server: 127.0.0.53
Auth-Port: 2525

EOF
  ;;
imap)
  CURL=(
    curl
    --fail
    --no-progress-meter
    --user "$AUTH_USER:$AUTH_PASS"
    --header "X-Real-IP: $CLIENT_IP"
    --unix-socket /run/local/nginx/direct_auth.sock
    -- localhost
  )

  if "${CURL[@]}"; then
    exec -- tee -- <<- 'EOF'
HTTP/1.0 200 OK
Auth-Status: OK
Auth-Server: 127.0.0.53
Auth-Port: 1443

EOF
  fi
  ;;
*)
  exit 1
  ;;
esac

tee -- <<- 'EOF'
HTTP/1.0 200 OK
Auth-Status: Invalid login or password

EOF
