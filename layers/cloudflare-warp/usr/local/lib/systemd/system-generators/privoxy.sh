#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail
shopt -u failglob

RUN="$1"
WANTS="$RUN/multi-user.target.wants"

TPL="$RUN/0-privoxy@.service"
cp -f -- /usr/lib/systemd/system/privoxy.service "$TPL"
mkdir -v -p -- "$WANTS"

for CONF in /usr/local/opt/privoxy/conf.d/*.conf; do
  CONF="${CONF%'.conf'}"
  CONF="$(systemd-escape -- "${CONF//[[:space:]]/''}")"
  ln -v -snf -- "$TPL" "$WANTS/0-privoxy@$CONF.service"
done
