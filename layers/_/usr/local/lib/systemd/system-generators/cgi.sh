#!/usr/bin/env -S -- bash -Eeuo pipefail -O dotglob -O nullglob -O extglob -O globstar

RUN="$1"
CGI='/usr/local/lib/cgi/'
WANTS="$RUN/sockets.target.wants"

mkdir --parents -- "$WANTS"

for FILE in "$CGI"*; do
  if [[ -x "$FILE" ]]; then
    NAME="${FILE##"$CGI"}"
    ESC="$(systemd-escape -- "$NAME")"

    SOCK="06-cgi-$ESC.socket"
    cp --force -- "$CGI/06-cgi-.socket" "$RUN/$SOCK"
    cp --force -- "$CGI/06-cgi-@.service" "$RUN/06-cgi-$ESC@.service"
    ln --force --symbolic -- "$RUN/$SOCK" "$WANTS/$SOCK"
  fi
done
