#!/usr/bin/env -S -- bash -Eeu -o pipefail -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

Y2J=(yq --output-format json)
J2Y=(yq --input-format json '(.. | select(tag == "!!str")) style="single" | (.. | select(tag == "!!str" and test("\n"))) style="literal"')

"${Y2J[@]}" | jq --slurp "$@" | "${J2Y[@]}"
