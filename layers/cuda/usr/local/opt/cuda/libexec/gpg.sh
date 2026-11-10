#!/usr/bin/env -S -- bash -Eeuo pipefail -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

URI="$(sed -E -e 's/.*(https:[^ ]+).*/\1/' -- /etc/apt/sources.list.d/cuda.list)"
printf -- '%s' "${URI%/}/cuda-archive-keyring.gpg"
