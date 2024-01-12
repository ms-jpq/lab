#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

TMP="$(mktemp --directory)"
URI='https://github.com/Spotifyd/spotifyd/releases/latest/download/spotifyd-linux-full.tar.gz'
curl --fail --location --no-progress-meter -- "$URI" | tar --extract -z --file - --directory "$TMP"
mv -v -f -- "$TMP"/* "$1/"
