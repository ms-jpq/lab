#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

PIDFILE="$1"
PID="$(< "$PIDFILE")"

# https://docs.python.org/3/library/os.html#os.sched_setaffinity
for TASK in "/proc/$PID/task"/*; do
  NAME="$(grep -- '^Name:' "$TASK/status" | cut --field 2-)"
  printf -- '%s\n' "$NAME" >&2
  case "$NAME" in
  'CPU '*) ;;
  'IO '* | 'iou-'*) ;;
  *) ;;
  esac
done
