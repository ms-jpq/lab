#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O globstar

set -o pipefail

MAIL="$2/mail"
mkdir -p -- "$MAIL"

LS="$(
  for F in /var/lib/local/vmail/*; do
    printf -- '%s\n' "${F##*/}"
  done | jq --raw-input --raw-output '[.] | map("\(.)#\(. | @uri)")[]'
)"

readarray -t -- LINES <<<"$LS"

IFS=','
PARAMS="${LINES[*]}"
unset -- IFS

/usr/local/libexec/m4.sh -D"ENV_INBOXES=$PARAMS" "${0%/*}/roundcube.html" | sponge -- "$MAIL/index.html"
