#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

SERVICES="${0%/*}/../services"

E="$(sed -E -e '/^[[:space:]]*#/d' -- "$@" | awk '{ print $1 }')"
readarray -t -- EXPORTS <<<"$E"

export -- EXPORT

FILES=()
for EXPORT in "${EXPORTS[@]}"; do
  NAME="nfs$(systemd-escape -- "$EXPORT")"
  DNSSD="/usr/local/lib/systemd/dnssd/$NAME.dnssd"
  FILES+=("$DNSSD")

  envsubst <"$SERVICES/nfs.dnssd" >"$DNSSD"
  envsubst <"$SERVICES/nfs.service.xml" >"/etc/avahi/services/$NAME.service"
done

chown -v -- systemd-resolve:systemd-resolve "${FILES[@]}"
