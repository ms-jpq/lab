#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

URI='https://github.com/Spotifyd/spotifyd/releases/latest/download/spotifyd-linux-full.tar.gz'
curl --fail --location --no-progress-meter -- "$URI" | tar --extract --file - --directory "$1"
