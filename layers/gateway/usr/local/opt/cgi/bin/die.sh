#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

if [[ ! -t 1 ]]; then
  exec <&3 >&3
fi

COOKIE=_htpasswd

DOMAIN=''
while read -r LINE; do
  LINE="${LINE%$'\r'}"
  if [[ -z "$LINE" ]]; then
    break
  fi

  LHS="${LINE%%:*}"
  KEY="${LHS,,}"
  case "$KEY" in
  host)
    DOMAIN="$(sed -E -e 's/.*\.([^.]+\.[^.]+)$/\1/' <<<"${LINE##*: }")"
    DOMAIN="Domain=$DOMAIN"
    ;;
  *) ;;
  esac
done

tee -- <<-EOF
HTTP/1.0 307
Set-Cookie: $COOKIE=; Max-Age=0; HttpOnly; Path=/; $DOMAIN
Location: /

EOF
