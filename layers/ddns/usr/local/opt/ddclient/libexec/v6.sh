#!/usr/bin/env -S -- bash -Eeu -o pipefail -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

# https://github.com/ddclient/ddclient/blob/main/ddclient.in#L275
exec -- curl --fail --location --no-progress-meter -6 -- https://api6.ipify.org
