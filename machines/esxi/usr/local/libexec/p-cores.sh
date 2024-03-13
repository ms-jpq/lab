#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

CPUS="$(lscpu --extended --json)"
JQ=(jq --exit-status)
# intel E cores do not have hyperthreading -> 2 cpus / core
P_CORES="$("${JQ[@]}" '.cpus[].core' <<<"$CPUS" | sort | uniq --repeated | "${JQ[@]}" --slurp)"

read -r -d '' -- FILTER <<-'JQ' || true
[.cpus[] | select(.core | IN($pcores[])) | .cpu] | join(",")
JQ

"${JQ[@]}" --raw-output --argjson pcores "$P_CORES" "$FILTER" <<<"$CPUS"
