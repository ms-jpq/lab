#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

RUN="$1"

CONF=/usr/local/opt/-.service
for I in {0..9}; do
  DROPIN="$RUN/$I-.service.d"
  mkdir -v -p -- "$DROPIN"
  NAME="$DROPIN/-.conf"
  cp -v -f -- "$CONF" "$NAME"
  CONF="$NAME"
done
