#!/usr/bin/env -S -- bash -Eeu -o pipefail -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail
shopt -u failglob

OPTS='d,p'
LONG_OPTS='diff,prune'
GO="$(getopt --options="$OPTS" --longoptions="$LONG_OPTS" --name="$0" -- "$@")"
eval -- set -- "$GO"

DIFF=0
PRUNE=()
while (($#)); do
  case "$1" in
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

CTL=(env -- KUBECONFIG="${0%/*}/facts/$SRC.kubeconfig.yml.env" kubectl --insecure-skip-tls-verify)
cat -- "$DST"/*.yml | if ((DIFF)); then
  "${CTL[@]}" diff --filename - | delta
else
  "${CTL[@]}" apply "${PRUNE[@]}" --filename -
fi
