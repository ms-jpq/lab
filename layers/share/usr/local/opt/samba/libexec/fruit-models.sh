#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

read -r -d '' -- JQ << JQ || true
[.UTExportedTypeDeclarations[] | select(.UTTypeIcons // {} | .UTTypeIconFile).UTTypeTagSpecification // {} | .["com.apple.device-model-code"] // [] | [.]] | flatten[]
JQ

"${0%/*}/fruit-models.py" | jq --exit-status --raw-output "$JQ" | sort
