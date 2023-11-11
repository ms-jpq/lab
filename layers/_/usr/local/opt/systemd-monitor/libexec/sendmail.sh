#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O globstar

set -o pipefail

RUN="$1"
REMOTE="$2"

if [[ -z "$REMOTE" ]]; then
  exit
fi

TXTS=("$RUN"/*.txt)

if (("${#TXTS[@]}")); then
  exit
fi

TMP="$(mktemp)"
FROM="$USER@$HOSTNAME"
RCPT="$HOSTNAME@$REMOTE"

tee -- "$TMP" <<-EOF
From: <$FROM>
To: <$RCPT>
Subject: $0

EOF

CURL=(
  curl --fail
  --ssl-reqd --insecure
  --mail-from "$FROM"
  --mail-rcpt "$RCPT"
  --upload-file "$TMP"
)

for R in "${TXTS[@]}"; do
  N="${R##*/}"
  N="${N%.txt}"
  CURL+=(--upload-file "$R")
done

CURL+=(
  --no-progress-meter
  -- "smtps://$REMOTE"
)

exec -- "${CURL[@]}"
