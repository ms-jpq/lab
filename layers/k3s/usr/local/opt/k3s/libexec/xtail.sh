#!/usr/bin/env -S -- bash -Eeu -o pipefail -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

RUN="$1"
LOG="$2"
NAME="$(b3sum --no-names --length 16 <<< "$LOG")"

tee -- /dev/null > "$RUN/$NAME" <<- EOF
LOGFILE="$LOG"
EOF

exec -- systemctl start --runtime -- "1-k8s-container-log@$NAME.service"
