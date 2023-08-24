#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

CACHE="$1/"

TMP="$(mktemp)"
chmod g+r,o+r -- "$TMP"
for CONF in "$CACHE"*.conf; do
  NAME="${CONF#"$CACHE"}"
  qrencode --output "$TMP" <"$CONF"
  mv -- "$TMP" "$CACHE$NAME.png"
done
