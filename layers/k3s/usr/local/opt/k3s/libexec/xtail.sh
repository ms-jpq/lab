#!/usr/bin/env -S -- bash -Eeu -o pipefail -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

RUN="$1"
LOG="$2"
ID="$(b3sum --no-names --length 16 <<< "$LOG")"
NAME="${LOG##*/}"
NAME="${NAME%-*}"

tee -- /dev/null > "$RUN/$ID" <<- EOF
NAME="$NAME"
LOGFILE="$LOG"
EOF

exec -- systemctl start --no-block --runtime -- "1-k8s-container-wait@$ID.service"
