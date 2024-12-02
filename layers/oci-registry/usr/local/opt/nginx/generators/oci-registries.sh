#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail
shopt -u failglob

RUN="$1"

for SOCK in /run/local/oci-registry/proxy/*.sock; do
  BASE="${SOCK##*/}"
  BASE="${BASE%'.sock'}"
  LOCATION="${BASE%'.sock'}" envsubst < /usr/local/opt/oci-registry/server.nginx
done > "$RUN/http.d/oci-registry.nginx"
