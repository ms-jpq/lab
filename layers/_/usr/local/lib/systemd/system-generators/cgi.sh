#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

RUN="$1"
WANTS="$RUN/sockets.target.wants"

mkdir -v -p -- "$WANTS"
for BIN in /usr/local/opt/cgi/bin/*; do
  if [[ -x "$BIN" ]]; then
    NAME="6-cgi-${BIN##*/}"
    SOCK="$RUN/$NAME.socket"
    cp -v -f -- /usr/local/opt/cgi/6-cgi-@.service "$RUN/$NAME.service"
    cp -v -f -- /usr/local/opt/cgi/6-cgi-.socket "$SOCK"
    ln -v -sf -- "$SOCK" "$WANTS/$NAME.socket"
  fi
done
