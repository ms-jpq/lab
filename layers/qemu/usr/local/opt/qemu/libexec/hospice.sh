#!/usr/bin/env -S -- bash -Eeuo pipefail -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

if ! [[ -v MAINPID ]]; then
  exit
fi

if ! timeout "$@"; then
  CODE="$?"
  if ((CODE == 124)); then
    exit 0
  else
    exit "$CODE"
  fi
fi
