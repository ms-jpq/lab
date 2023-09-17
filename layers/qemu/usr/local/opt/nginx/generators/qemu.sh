#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O globstar

set -o pipefail

RUN="$1"
WWW="$2"
VNC='/run/local/qemu/'

HREFS=()
SOCKS=()

S='/ws.sock'
for SOCK in "$VNC"*"$S"; do
  BASE="${SOCK#"$VNC"}"
  BASE="qemu/${BASE%"$S"}"
  PARAMS="path=/$BASE/websocketify&reconnect=1&reconnect_delay=200&scale=1"
  HREFS+=("$BASE/vnc_lite.html?$PARAMS")
  SOCKS+=("$BASE:$SOCK")
done

IFS=','
/usr/local/libexec/m4.sh -D"ENV_HOST=$HOSTNAME" -D"ENV_HREFS=${HREFS[*]}" /usr/local/opt/nginx/generators/index.html | sponge -- "$WWW/qemu.html"
/usr/local/libexec/m4.sh -D"ENV_SOCKS=${SOCKS[*]}" /usr/local/opt/qemu/location.nginx >"$RUN/server.d/qemu.nginx"
unset -- IFS
