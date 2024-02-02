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

NOW="${EPOCHREALTIME%%.*}"

case "$1" in
cost)
  MONTH=31
  DAYS="${2:-"$MONTH"}"
  DELTA=$((60 * 60 * 24 * DAYS))
  BEGIN="$(date --utc --date="@$((NOW - DELTA))" -- '+%Y-%m-%d')"
  END="$(date --utc --date="@$NOW" -- '+%Y-%m-%d')"

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
{ print $0 " ~>" sprintf("%0.2f", $NF * month) }
END { print "<$> " sum }
EOF
  "${AWS[@]}" | "${JQ[@]}" "$JQJQ" | awk -v month="$MONTH" "$AWK" | column -t | sed -E -e 's/%/ /g'
  ;;
metrics)
  DELTA=$((60 * 60))

  AWS+=(
    --region us-west-2
    lightsail get-instance-metric-data
    --instance-name droplet
    --start-time $((NOW - DELTA))
    --end-time "$NOW"
    --statistics 'Average'
    --period 60
    --metric-name 'BurstCapacityTime'
    --unit 'Seconds'
  )
  "${AWS[@]}"
  ;;
*)
  set -x
  exit 2
  ;;
esac
