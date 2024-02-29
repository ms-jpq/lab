#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

read -r -d '' -- JQ <<-EOF || true
[.UTExportedTypeDeclarations[] | select(.UTTypeIcons // {} | .UTTypeIconFile).UTTypeTagSpecification // {} | .["com.apple.device-model-code"] // [] | [.]] | flatten[]
EOF

"${0%/*}/fruit-models.py" | jq --exit-status --raw-output "$JQ" | sort
