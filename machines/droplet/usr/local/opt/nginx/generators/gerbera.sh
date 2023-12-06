#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

RUN="$1"

URL="$(/usr/local/opt/gerbera/libexec/html.sh)"
if [[ -n "$URL" ]]; then
  # shellcheck disable=SC2016
  env -- "GERBERA_URL=$URL" envsubst -- '${GERBERA_URL}' <"${0%/*}/gerbera.nginx" >"$RUN/http.d/gerbera.nginx"
fi
