#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail
shopt -u failglob

RUN="$1"
REMOTE="$2"

if [[ -z $REMOTE ]]; then
  exit
fi

TXTS=()

for TXT in "$RUN"/*.txt; do
  if ! [[ -k $TXT ]]; then
    TXTS+=("$TXT")
  fi
done

if ! (("${#TXTS[@]}")); then
  exit
fi

TMP="$(mktemp)"

ACC=()
for TXT in "${TXTS[@]}"; do
  printf -- '%s\n' "> ${TXT##*/}" >> "$TMP"
  ACC+=(--attachment "$TXT")
done

read -r -- LINES < "$TMP"
TITLE="${LINES[*]}"

SENDMAIL=(
  /usr/local/libexec/sendmail.sh
  --rcpt "$REMOTE"
  --subject "$HOSTNAME - $TITLE"
  --body "$TMP"
  "${ACC[@]}"
)

SENDMAIL+=(-- --insecure)

"${SENDMAIL[@]}"

exec -- chmod -v -- +t "${TXTS[@]}"
