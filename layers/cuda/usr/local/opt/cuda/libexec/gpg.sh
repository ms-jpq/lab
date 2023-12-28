#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

URI="$(sed -E 's/.*(http:[^ ]+).*/\1/' -- /etc/apt/sources.list.d/cuda.list)"
printf -- '%s' "$URI/cuda-archive-keyring.gpg"
