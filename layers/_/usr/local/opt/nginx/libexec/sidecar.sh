#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

RUN="$1"
WWW="$2"

CONF_D=(
  conf.d
  http.d
  server.d
  stream.d
)

TMP="$(mktemp --directory)"

while true; do
  for CONF in "${CONF_D[@]}"; do
    mkdir --parents -- "$TMP/$CONF"
  done

  PIDS=()
  for EXEC in "${0%/*}/../generators"/*; do
    if [[ -x "$EXEC" ]]; then
      "$EXEC" "$TMP" "$WWW" &
      PIDS+=("$!")
    fi
  done
  for PID in "${PIDS[@]}"; do
    wait -- "$PID"
  done

  if ! diff --recursive --brief -- "$TMP" "$RUN"; then
    rsync --recursive --perms -- "$TMP/" "$RUN/"
    systemctl reload -- nginx.service
  fi

  rm --recursive --force -- "${TMP:?}"/*
  sleep -- 5
done
