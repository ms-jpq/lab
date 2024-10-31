#!/usr/bin/env -S -- bash -Eeu -o pipefail -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

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
if ! (($#)); then
  rm -fr -- "${DST:?}"/*
fi

./libexec/kompose.sh "$SRC" "$DST" "$@"
./libexec/helm-charts.sh "$DST"

if ((NOOP)); then
  exit
fi

cat -- "$DST"/*.yml | if ((DIFF)); then
  ./libexec/kubectl.sh diff --filename - | delta
else
  ./libexec/kubectl.sh apply "${PRUNE[@]}" --filename -
fi
