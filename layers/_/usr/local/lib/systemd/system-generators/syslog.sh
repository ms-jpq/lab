#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

RUN="$1"

for I in {0..9}; do
  DROPIN="$RUN/$I-.service.d"
  mkdir -v -p -- "$DROPIN"
  cp -v -f -- /usr/local/opt/-.service "$DROPIN/-.conf"
done
