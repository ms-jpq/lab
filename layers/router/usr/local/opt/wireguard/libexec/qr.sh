#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

DUMP="$1/"

TMP="$(mktemp)"
chmod g+r,o+r -- "$TMP"
for CONF in "$DUMP"*.conf; do
  NAME="${CONF#"$DUMP"}"
  qrencode --output "$TMP" <"$CONF"
  mv -- "$TMP" "$DUMP$NAME.png"
done
