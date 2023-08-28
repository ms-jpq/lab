#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O globstar

set -o pipefail

RUN="$1"
SELF="${0%/*}"
CGI='/run/local/cgi/'

HREFS=()
SOCKS=()

for SOCK in "$CGI"*.sock; do
  BASE="${SOCK#"$CGI"}"
  BASE="${BASE%'.sock'}"
  HREFS+=("$BASE")
  SOCKS+=("$BASE:$SOCK")
done

for TXT in "$SELF"/*.index; do
  readarray -t -- INDEX <"$TXT"
  HREFS+=("${INDEX[@]}")
done

IFS=','
/usr/local/libexec/m4.sh -D"ENV_HOST=$HOSTNAME" -D"ENV_HREFS=${HREFS[*]}" "$SELF/index.html" >"$RUN/www/index.html"
/usr/local/libexec/m4.sh -D"ENV_SOCKS=${SOCKS[*]}" '/usr/local/opt/cgi/location.nginx' >"$RUN/server.d/cgi.nginx"
unset -- IFS
