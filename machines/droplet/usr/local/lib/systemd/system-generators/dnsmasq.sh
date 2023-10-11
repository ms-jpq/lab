#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O globstar

set -o pipefail

RUN="$1"
WANTS="$RUN/default.target.wants"

# shellcheck disable=SC1091
source -- /usr/local/etc/default/wan.env

# shellcheck disable=SC2154
NAME="$(systemd-escape -- "${WAN_IF//[[:space:]]/''}")"

mkdir -v -p -- "$WANTS"
ln -v -sf -- /usr/lib/systemd/system/dnsmasq@.service "$WANTS/dnsmasq@$NAME.service"
