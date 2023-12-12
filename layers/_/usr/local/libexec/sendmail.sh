#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

OPTS='f:,r:,s:,h:,b:,a:'
LONG_OPTS='from:,rcpt:,subject:,header:,body:,attachment:'
GO="$(getopt --options="$OPTS" --longoptions="$LONG_OPTS" --name="$0" -- "$@")"
eval -- set -- "$GO"

esc() {
  ESC="$1"
  ESC="${ESC//\\/\\\\}"
  ESC="${ESC//\"/\\\"}"
  printf -- '%s' '"'"$ESC"'"'
}

FROM="$USER@$HOSTNAME"
HEADERS=()
BODY='/dev/null'
ATTACHMENTS=()
while (($#)); do
  case "$1" in
  --)
    shift -- 1
    break
    ;;
  -f | --from)
    FROM="$2"
    shift -- 2
    ;;
  -r | --rcpt)
    RCPT="$2"
    DOMAIN="${RCPT##*@}"
    shift -- 2
    ;;
  -s | --subject)
    HEADERS+=(--header "Subject: $2")
    shift -- 2
    ;;
  -h | --header)
    HEADERS+=(--header "$2")
    shift -- 2
    ;;
  -b | --body)
    BODY="$(esc "$2")"
    shift -- 2
    ;;
  -a | --attachment)
    FILE="$(esc "$2")"
    MIME="$(file --brief --mime-type -- "$2")"
    ATTACHMENTS+=(--form "=@$FILE;encoder=base64;type=$MIME")
    shift -- 2
    ;;
  *)
    exit 1
    ;;
  esac
done

CURL=(
  curl --fail
  --ssl-reqd
  --mail-from "$FROM"
  --mail-rcpt "$RCPT"
  --header "From: <$FROM>"
  --header "To: <$RCPT>"
  "${HEADERS[@]}"
  --form "=<$BODY;encoder=quoted-printable"
  "${ATTACHMENTS[@]}"
  --no-progress-meter
  "$@"
  -- "smtps://$DOMAIN"
)

exec -- "${CURL[@]}"
