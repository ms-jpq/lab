#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

FS="$1"
CGI='./layers/_/usr/local/opt/cgi'
SYSTEM="$FS/usr/local/lib/systemd/system"
WANTS="$SYSTEM/sockets.target.wants"
shift -- 1

for BIN in "$@"; do
  NAME="${BIN##*/}"
  NAME="${NAME//'.'/'\x2e'}"
  NAME="${NAME//'-'/'\x2d'}"

  SOCK="6-cgi-$NAME.socket"
  cp -v -f -- "$CGI/6-cgi-@.service" "$SYSTEM/6-cgi-$NAME@.service"
  cp -v -f -- "$CGI/6-cgi-.socket" "$SYSTEM/$SOCK"

  ln -v -sf -- "../$SOCK" "$WANTS/$SOCK"
  "${0%/*}/m5.sh" -D"ENV_PATH=$NAME" -D"ENV_SOCK=/run/local/cgi/$NAME.sock" "$CGI/location.nginx" >"$FS/usr/local/opt/nginx/conf/server.d/$NAME.cgi.nginx"
done
