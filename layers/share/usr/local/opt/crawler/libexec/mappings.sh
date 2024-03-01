#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

# mdimport -X | vipe

JQ=(jq --exit-status --raw-output)
T1=$(mktemp)
T2=$(mktemp)
"${JQ[@]}" '.attribute_mappings | to_entries[].value.attribute' /usr/share/samba/mdssvc/elasticsearch_mappings.json | sort --unique >"$T1"
"${JQ[@]}" '.properties | to_entries[] | if .value.properties then "\(.key).\((.value.properties // {} | keys)[])" else .key end' "${0%/*}/mappings.json" | sort --unique >"$T2"

exec -- git diff --no-index --no-prefix -- "$T1" "$T2"
