#!/usr/bin/env -S -- bash -Eeu -o pipefail -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

grep --invert-match -e '^#' -e '^$' -- /run/systemd/resolve/resolv.conf | sort --unique > /run/local/k3s/resolv.conf
