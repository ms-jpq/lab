#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

if [[ ! -t 1 ]]; then
  exec >&3
fi

tee -- <<-'EOF'
HTTP/1.0 200 OK
Content-Type: text/plain; charset=utf-8

EOF

/usr/local/libexec/hr-run.sh curl --fail-with-body --location --no-progress-meter -- localhost:8080/nginx
/usr/local/libexec/hr-run.sh nginx -c /usr/local/opt/nginx/conf/main.nginx -T
