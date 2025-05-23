#!/usr/bin/env -S -- bash -Eeu -o pipefail -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail
shopt -u failglob

OPTS='n,d,p'
LONG_OPTS='noop,diff,prune'
GO="$(getopt --options="$OPTS" --longoptions="$LONG_OPTS" --name="$0" -- "$@")"
eval -- set -- "$GO"

NOOP=0
DIFF=0
PRUNE=()
while (($#)); do
  case "$1" in
  -n | --noop)
    NOOP=1
    shift -- 1
    ;;
  -d | --diff)
    DIFF=1
    shift -- 1
    ;;
  -p | --prune)
    PRUNE=(--prune --all)
    shift -- 1
    ;;
  --)
    SRC="$2"
    DST="./var/tmp/k8s/$SRC"
    shift -- 2
    break
    ;;
  *)
    exit 1
    ;;
  esac
done

cd -- "${0%/*}"

mkdir -p -- "$DST"
find "$DST" -mindepth 1 -delete

./libexec/kompose.sh "$SRC" "$DST" "$@"
if (($#)); then
  PRUNE=()
fi

if ((NOOP)); then
  exit
fi

CTL=(./libexec/kubectl.sh "$SRC")
cat -- "$DST"/*.yml | if ((DIFF)); then
  "${CTL[@]}" diff --filename - | delta
else
  "${CTL[@]}" apply "${PRUNE[@]}" --filename -
fi
