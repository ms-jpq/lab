#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

AWS=(
  "${0%/*}/../.venv/bin/aws"
  --output json
)

JQ=(
  jq
  --exit-status
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
cpu)
  DELTA=$((60 * 60 * 24))
  AWS+=(
    --region us-west-2
    lightsail
  )
  IS="$("${AWS[@]}" get-instances | "${JQ[@]}" '.instances[].name')"
  readarray -t -- INSTANCES <<<"$IS"
  read -r -d '' -- JQJQ <<-'EOF' || true
.metricData[] | "\(.timestamp | strftime("%Y-%m-%d %H:%M:%S")) -> \(.average | floor) \(.unit)"
EOF

  for INSTANCE in "${INSTANCES[@]}"; do
    AWS+=(
      get-instance-metric-data
      --instance-name "$INSTANCE"
      --start-time $((NOW - DELTA))
      --end-time "$NOW"
      --statistics 'Average'
      --period 60
      --metric-name 'BurstCapacityTime'
      --unit 'Seconds'
    )

    printf -- '%s\n' "-> $INSTANCE" >&2
    "${AWS[@]}" | "${JQ[@]}" "$JQJQ" | sort --key 1,2
  done
  ;;
*)
  set -x
  exit 2
  ;;
esac
