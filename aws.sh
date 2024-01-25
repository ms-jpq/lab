#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

AWS=(
  aws
  --output json
)

JQ=(
  jq
  --raw-output
)

case "$1" in
cost)
  DAYS="${2:-30}"
  NOW="${EPOCHREALTIME%%.*}"
  DELTA=$((60 * 60 * 24 * DAYS))
  BEGIN="$(date --utc --date="@$((NOW - DELTA))" -- '+%Y-%m-%d')"
  END="$(date --utc -- '+%Y-%m-%d')"

  AWS+=(
    ce get-cost-and-usage
    --granularity 'DAILY'
    --time-period "Start=$BEGIN,End=$END"
    --metrics 'UnblendedCost'
  )
  JQ+=(
    '.ResultsByTime[].Total.UnblendedCost | "\(.Unit) \(.Amount)"'
  )
  ;;
*)
  set -x
  exit 2
  ;;
esac

exec -- "${AWS[@]}" | "${JQ[@]}"
