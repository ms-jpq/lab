#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

LIB='/var/lib/local/nginx'
PASSWD="$LIB/gateway.htpasswd"

touch -- "$PASSWD"

HR="$("${0%/*}/../libexec/hr.sh")"
printf -- '%s\n%q\n%s\n' "$HR" "$PASSWD" "$HR"

ARGV=(htpasswd -b -- "$PASSWD" "$@")
if (($#)); then
  "${ARGV[@]}"
fi
cat -- "$PASSWD"
