#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

cd -- "${0%/*}"

OPTS='m:'
LONG_OPTS='machine:'
GO="$(getopt --options="$OPTS" --longoptions="$LONG_OPTS" --name="$0" -- "$@")"
eval -- set -- "$GO"

USER=root
while (($#)); do
  case "$1" in
  --)
    shift -- 1
    break
    ;;
  -m | --machine)
    MACHINE="$2"
    shift -- 2
    ;;
  *)
    exit 1
    ;;
  esac
done

gmake local

if ! [[ -v MACHINE ]]; then
  exit
fi

SRC="./var/tmp/machines/$MACHINE"

set -x
if ! [[ -d "$SRC" ]]; then
  exit 1
fi
set +x
