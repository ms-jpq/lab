#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O globstar

set -o pipefail

TMP="$1"
CGI='/run/local/cgi/'

HREFS=()

for SOCK in "$CGI"*.sock; do
  BASE="${SOCK#"$CGI"}"
  BASE="${BASE%'.sock'}"
  HREFS+=("$BASE")
done

IFS=','
/usr/local/libexec/m4.sh -D"ENV_HOST=$HOSTNAME" -D"ENV_HREFS=${HREFS[*]}" "${0%/*}/index.html" >"$TMP/www/index.html"
unset -- IFS
