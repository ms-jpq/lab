#!/usr/bin/env -S -- bash -Eeu -o pipefail -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail
shopt -u failglob

OPTS=''
LONG_OPTS='up,down'
GO="$(getopt --options="$OPTS" --longoptions="$LONG_OPTS" --name="$0" -- "$@")"
eval -- set -- "$GO"

UP=1
while (($#)); do
  case "$1" in
  --up)
    UP=1
    shift -- 1
    ;;
  --down)
    UP=0
    shift -- 1
    ;;
  --)
    SRC="$2"
    shift -- 2
    break
    ;;
  *)
    exit 1
    ;;
  esac
done

cd -- "${0%/*}"

STATE='False'
if ((UP)); then
  STATE='True'
fi

./libexec/wsync.sh --machine "$SRC"
exec -- ssh -- "$SRC" powershell.exe -File '%SYSTEMDRIVE%/Crowdstrike/stacks.ps1' "-up \$$STATE"
