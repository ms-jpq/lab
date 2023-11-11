#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O globstar

set -o pipefail

RUN="$1"
REMOTE="$2"

CURL=(
  curl --fail
  --ssl-reqd
  --mail-from "$USER@$HOSTNAME"
  --mail-rcpt "$HOSTNAME@$REMOTE"
)

TXTS=("$RUN"/*.txt)

for R in "${TXTS[@]}"; do
  N="${R##*/}"
  N="${N%.txt}"
  CURL+=(--upload-file "$R")
done

CURL+=(
  --no-progress-meter
  -- "smtps://$REMOTE"
)

"${CURL[@]}"
