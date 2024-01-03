#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O globstar

set -o pipefail

RUN="$1"
WWW="$2"
TMP="$3"

for EXEC in "${0%/*}/../generators"/*; do
  if [[ -x "$EXEC" ]]; then
    printf -- '%s\0' "$EXEC"
  fi
done | xargs --null -I '%' --max-args 1 --max-procs 0 -- env -- '%' "$TMP" "$WWW"

if ! diff --recursive --brief -- "$TMP" "$RUN"; then
  rm -rf -- "$RUN/ssl/"*
  rsync --recursive --perms -- "$TMP/" "$RUN/"
  systemctl try-reload-or-restart -- nginx.service
fi
