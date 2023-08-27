#!/usr/bin/env sh

set -eu

OPTS='{"OrderBy": "size", "Checkers": 16, "Transfers": 16}'

rc() {
  rclone rc \
    --rc-addr=rclone-rcd:8080 \
    -- \
    "$@"
}

apk add -- jq

while true; do
  while true; do
    _TMP="$(rc job/list)"
    _JOBS="$(printf -- '%s' "$_TMP" | jq '.jobids[]')"
    JOBS="$(printf -- '%s' "$_JOBS" | wc -l)"
    if [ "$JOBS" -eq 0 ]; then
      break
    else
      sleep 10
    fi
  done

  rc sync/sync _config="$OPTS" _async=true createEmptySrcDirs=true srcFs=/media dstFs="<%= fs.rclone_remote %>":/
  sleep 600
done
