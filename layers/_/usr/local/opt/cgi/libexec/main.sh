#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

SELF="$(realpath -- "$0")"
SELF="${SELF%/*}/.."
RUN="$(realpath -- "$1")"

CGI="$SELF/bin/"
WANTS="$RUN/sockets.target.wants"

mkdir -v --parents -- "$WANTS"
for FILE in "$CGI"*; do
  NAME="${FILE##"$CGI"}"
  ESC="$(systemd-escape -- "$NAME")"

  SOCK="6-cgi-$ESC.socket"
  cp -v --force -- "$SELF/systemd/6-cgi-.socket" "$RUN/$SOCK"
  cp -v --force -- "$SELF/systemd/6-cgi-@.service" "$RUN/6-cgi-$ESC@.service"
  ln -v --force --symbolic -- "$RUN/$SOCK" "$WANTS/$SOCK"
done
