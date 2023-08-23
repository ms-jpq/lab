#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O globstar

set -o pipefail

TMP="$1"
CGI='/run/local/cgi/'

ENV_NGINX=()
ENV_HREFS=()

for SOCK in "$CGI"*.sock; do
  BASE="${SOCK#"$CGI"}"
  BASE="${BASE%'.sock'}"
  ENV_NGINX+=("[$BASE, $SOCK]")
  ENV_HREFS+=("$BASE")
done

IFS=','
/usr/local/libexec/m4.sh -D"ENV_HOST=$HOSTNAME" -D"ENV_HREFS=${ENV_HREFS[*]}" "${0%/*}/index.html" >"$TMP/www/index.html"
unset -- IFS
