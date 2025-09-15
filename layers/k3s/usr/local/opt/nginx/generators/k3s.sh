#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail
shopt -u failglob

RUN="$1"

if [[ -f /var/lib/rancher/k3s/server/tls/client-admin.crt ]]; then
  cp -- "${0%/*}/k3s.nginx" "$RUN/server.d/k3s.nginx"
fi
