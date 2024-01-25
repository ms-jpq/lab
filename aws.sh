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

  read -r -d '' -- JQJQ <<-'EOF' || true
def amount: .Metrics.UnblendedCost.Amount;
.ResultsByTime[] as $t | $t.Groups[] | select(amount != "0") | "\($t.TimePeriod.End) \(.Keys[] | gsub("\\s"; "%")) \(amount)"
EOF

  AWS+=(
    ce get-cost-and-usage
    --granularity 'DAILY'
    --time-period "Start=$BEGIN,End=$END"
    --metrics 'UnblendedCost'
    --group-by 'Type=DIMENSION,Key=SERVICE'
  )
  read -r -d '' -- AWK <<-'EOF' || true
BEGIN { sum = 0 }
{ sum += $NF }
{ print $0 " ~>" sprintf("%0.2f", $NF * 30) }
END { print "<$> " sum }
EOF
  "${AWS[@]}" | "${JQ[@]}" "$JQJQ" | awk "$AWK" | column -t | sed -E -- 's/%/ /g'
  ;;
*)
  set -x
  exit 2
  ;;
esac
