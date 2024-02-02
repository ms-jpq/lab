#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

CACHE="$1"
VENV="$CACHE/venv"
STAMP="$VENV/stamp"

if ! [[ -v RECUR ]]; then
  mkdir -v -p -- "$CACHE"
  if RECUR=1 flock "$CACHE" "$0" "$@"; then
    touch -- "$STAMP"
  else
    C="$?"
    rm -v -fr -- "$VENV"
    exit $((C))
  fi
else
  if ! [[ -f "$STAMP" ]]; then
    python3 -m venv --clear -- "$VENV"
  fi
  rm -v -fr -- "$STAMP"
  "$VENV/bin/python3" -m pip install --require-virtualenv --cache-dir "$CACHE" --upgrade -- certbot
fi
