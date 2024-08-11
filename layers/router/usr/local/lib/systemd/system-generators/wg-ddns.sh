#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O globstar

set -o pipefail

RUN="$1"
WANTS="$RUN/timers.target.wants"

NETDEVS='/usr/local/lib/systemd/network'
SEARCH=(sed -E -n -e '/^\[WireGuard\]$/F' -- "$NETDEVS"/*.netdev)
SELECT=(xargs -r -I % -- sed -E -n -e 's/^Name[[:space:]]*=[[:space:]]*(.*)$/\1/p' -- %)
ROWS=$("${SEARCH[@]}" | "${SELECT[@]}")
readarray -t -- NETDEVS <<< "$ROWS"

mkdir -p -- "$WANTS"
for NETDEV in "${NETDEVS[@]}"; do
  NAME=$(systemd-escape -- "$NETDEV")
  ln -sf -- /usr/local/lib/systemd/system/1-wg-ddns@.timer "$WANTS/1-wg-ddns@$NAME.timer"
done
