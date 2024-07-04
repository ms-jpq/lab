#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

if [[ ! -t 1 ]]; then
  exec <&3 >&3
fi

tee -- <<- 'EOF'
HTTP/1.0 200 OK
Content-Type: text/plain; charset=utf-8

EOF

GIXY='/opt/python3/gixy'

while read -r LINE; do
  LINE="${LINE%$'\r'}"
  if [[ -z $LINE ]]; then
    break
  fi
  printf -- '%s\n' "> $LINE"
done

printf -- '\n\n'

/usr/local/libexec/hr-run.sh curl --fail-with-body --location --unix /run/local/nginx/cgi.sock --no-progress-meter -- localhost/nginx
/usr/local/libexec/hr-run.sh nginx -c /usr/local/opt/nginx/conf/main.nginx -T
PYTHONPATH="$GIXY" /usr/local/libexec/hr-run.sh "$GIXY/bin/gixy" -- /usr/local/opt/nginx/conf/main.nginx
