#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail
shopt -u failglob

RUN="$1"
WANTS="$RUN/multi-user.target.wants"
TIMERS="$RUN/timers.target.wants"

OCI_REGISTRIES="$(< /usr/local/etc/default/oci-registry.env)"
readarray -t -- REGISTRIES <<< "$OCI_REGISTRIES"

mkdir -v -p -- "$WANTS" "$TIMERS"
for REGISTRY in "${REGISTRIES[@]}"; do
  REGISTRY="${REGISTRY//[[:space:]]/''}"
  if [[ -z $REGISTRY ]]; then
    continue
  fi
  NAME="$(systemd-escape -- "$REGISTRY")"
  ln -v -snf -- /usr/local/lib/systemd/system/1-registry-proxy@.service "$WANTS/1-registry-proxy@$NAME.service"
  ln -v -snf -- /usr/local/lib/systemd/system/1-registry-gc@.timer "$TIMERS/1-registry-gc@$NAME.service"
done
