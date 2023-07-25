#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

CGI='/run/cgi/'
TITLE="$(basename -- "$0")"
LOCATION_D="$1/$TITLE.conf"
WWW="$4/index.html"

declare -A -- SOCKS

for SOCK in "$CGI"**.sock; do
  BASE="${SOCK##"$CGI"}"
  BASE="${BASE%%'.sock'}"
  SOCKS["$BASE"]="$SOCK"
done

for BASE in "${!SOCKS[@]}"; do
  SOCK="${SOCKS["$BASE"]}"

  read -r -d '' -- CONF <<-EOF || true
location /$BASE {
  return 307 /$BASE/;
}

location /$BASE/ {
  error_log        stderr crit;
  proxy_buffering  off;
  proxy_pass http://unix:$SOCK:/;
}
EOF

  printf -- '\n%s\n' "$CONF" >>"$LOCATION_D"
done

body() {
  SOCKS['nginx']=''
  SOCKS['netdata']=''

  printf -- '%s\n' '<ul>'
  for BASE in "${!SOCKS[@]}"; do
    read -r -d '' -- CONF <<-EOF || true
<li>
  <a href="/$BASE/">$BASE</a>
</li>
EOF
    printf -- '\n%s\n' "$CONF"
  done
  printf -- '%s\n' '</ul>'
}

BODY="$(body)"
export -- TITLE BODY
envsubst </usr/local/lib/nginx/index.html >"$WWW"
