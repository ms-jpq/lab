#!/usr/bin/env -S -- bash -Eeu -o pipefail -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

exec -- curl --fail --location --no-progress-meter -4 -- https://checkip.amazonaws.com
