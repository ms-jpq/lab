#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

OPTS='l:,n:,a:'
LONG_OPTS='lang:,name:,action:'
GO="$(getopt --options="$OPTS" --longoptions="$LONG_OPTS" --name="$0" -- "$@")"
eval -- set -- "$GO"

while (($#)); do
  case "$1" in
  --)
    shift -- 1
    break
    ;;
  -l | --lang)
    LAN="$2"
    shift -- 2
    ;;
  -n | --name)
    NAME="$2"
    shift -- 2
    ;;
  -a | --action)
    ACTION="$2"
    shift -- 2
    ;;
  *)
    exit 1
    ;;
  esac
done

DATA=/var/lib/local/weechat/data

SRC="/var/cache/local/weechat/scripts/$LAN/$NAME"
DST="$DATA/$LAN/$NAME"
AUTO="$DATA/$LAN/autoload/$NAME"

case "$ACTION" in
install)
  if [[ -f $SRC ]]; then
    ln -v -sf -- "$SRC" "$DST"
    ln -v -sf -- "../$NAME" "$AUTO"
  fi
  ;;
uninstall)
  rm -v -fr -- "$DST" "$AUTO"
  ;;
*)
  exit 1
  ;;
esac
