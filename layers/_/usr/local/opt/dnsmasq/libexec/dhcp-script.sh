#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

for EXEC in "${0%/*}/../dhcp-script.d"/*; do
  if [[ -x "$EXEC" ]]; then
    printf -- '%s\0' "$EXEC"
  fi
done | xargs --null -I '%' --max-args 1 --max-procs 0 -- env -- '%' "$@"
