#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O globstar

set -o pipefail

RUN="$1"
WANTS="$RUN/multi-user.target.wants"

# shellcheck disable=SC1091
source -- /usr/local/etc/default/wan.env

# shellcheck disable=SC2154
NAME="$(systemd-escape -- "${WAN_IF//[[:space:]]/''}")"

mkdir -v -p -- "$WANTS"
cp -v -rf -- /usr/local/opt/dnsmasq/ip-alloc@.service.d "$RUN/1-ip-alloc@$NAME.service.d"
ln -v -sf -- /usr/lib/systemd/system/dnsmasq@.service "$WANTS/dnsmasq@$NAME.service"
