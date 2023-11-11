#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O globstar

set -o pipefail

RUN="$1"
REMOTE="$2"

if [[ -z "$REMOTE" ]]; then
  exit
fi

TXTS=()

for TXT in "$RUN"/*.txt; do
  if ! [[ -k "$TXT" ]]; then
    TXTS+=("$TXT")
  fi
done

if ! (("${#TXTS[@]}")); then
  exit
fi

TMP="$(mktemp)"

SENDMAIL=(
  /usr/local/libexec/sendmail.sh
  --rcpt "$HOSTNAME@$REMOTE"
  --header "Subject: $0"
  --body "$TMP"
)

for TXT in "${TXTS[@]}"; do
  printf -- '%s\n' "> ${TXT##*/}" >>"$TMP"
  SENDMAIL+=(--attachment "$TXT")
done

SENDMAIL+=(-- --insecure)

"${SENDMAIL[@]}"

exec -- chmod -v -- +t "${TXTS[@]}"
