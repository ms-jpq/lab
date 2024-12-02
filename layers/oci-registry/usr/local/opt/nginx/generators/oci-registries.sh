#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail
shopt -u failglob

RUN="$1"

REGISTRIES=()
for SOCK in /run/local/oci-registry/proxy/*.sock; do
  BASE="${SOCK##*/}"
  BASE="${BASE%'.sock'}"
  REGISTRIES+=("${BASE%'.sock'}")
done

IFS=','
/usr/local/libexec/m4.sh -D"ENV_REGISTRIES=${REGISTRIES[*]}" /usr/local/opt/oci-registry/server.nginx | sponge -- "$RUN/http.d/oci-registry.nginx"
unset -- IFS
