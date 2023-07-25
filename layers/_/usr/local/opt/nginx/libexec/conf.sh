#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

cd -- "${0%/*}/.."

WWW='www'
RUN='/run/nginx'
CONF_D=(
  location.d
  http.d
  stream.d
  "$WWW"
  conf.d
)

while true; do
  TMPS=()
  for CONF in "${CONF_D[@]}"; do
    TMPS+=("$(mktemp --directory)")
  done

  PIDS=()
  for EXEC in ./gen/*; do
    if [[ -x "$EXEC" ]]; then
      "$EXEC" "${TMPS[@]}" &
      PIDS+=("$!")
    fi
  done

  for PID in "${PIDS[@]}"; do
    wait -- "$PID"
  done

  RELOAD=0
  for IDX in "${!TMPS[@]}"; do
    TMP="${TMPS[$IDX]}"
    CONF="${CONF_D[$IDX]}"

    if ! diff -- "$TMP" "$RUN/$CONF"; then
      rsync --archive --delete -- "$TMP/" "$RUN/$CONF/"
      if [[ "$CONF" != "$WWW" ]]; then
        RELOAD=1
      fi
    fi
  done

  rm --recursive --force -- "${TMPS[@]}"

  if ((RELOAD)); then
    systemctl reload -- nginx.service
  fi

  sleep -- 5
done
