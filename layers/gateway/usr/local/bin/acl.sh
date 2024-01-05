#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

HT='/var/lib/local/htpasswd'

PASSWD="$HT/htpasswd"
mkdir -v -p -- "$HT"
touch -- "$PASSWD"

HR="$("${0%/*}/../libexec/hr.sh")"
printf -- '%s\n%q\n%s\n' "$HR" "$PASSWD" "$HR"

ARGV=(htpasswd -b -- "$PASSWD" "$@")
if (($#)); then
  "${ARGV[@]}"
fi
cat -- "$PASSWD"
