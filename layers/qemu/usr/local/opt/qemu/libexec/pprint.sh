#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

while (($#)); do
  NEXT="${2:-""}"
  if [[ -n "$NEXT" ]] && ! [[ "$NEXT" =~ ^- ]]; then
    CH=' '
  else
    CH='\n'
  fi
  printf -- "%s$CH" "$1"
  shift -- 1
done | column --table >&2
