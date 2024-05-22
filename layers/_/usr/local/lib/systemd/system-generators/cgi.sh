#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail
shopt -u failglob

RUN="$1"
WANTS="$RUN/sockets.target.wants"

mkdir -v -p -- "$WANTS"
for BIN in /usr/local/opt/cgi/bin/*; do
  if [[ -x $BIN ]]; then
    NAME="$(systemd-escape -- "${BIN##*/}")"
    NAME="6-cgi-$NAME"
    SOCK="$RUN/$NAME.socket"
    SVC="$RUN/$NAME@.service"
    cp -v -f -- /usr/local/opt/cgi/6-cgi-@.service "$SVC"
    cp -v -f -- /usr/local/opt/cgi/6-cgi-.socket "$SOCK"
    chmod g+r,o+r -- "$SVC" "$SOCK"
    ln -v -sf -- "$SOCK" "$WANTS/$NAME.socket"
  fi
done
