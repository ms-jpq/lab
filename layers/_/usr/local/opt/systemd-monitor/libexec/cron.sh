#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O globstar

set -o pipefail

RUN="$1"

declare -A -- FAILED
FU="$(systemctl --output json --failed | jq --raw-output '.[].unit')"
readarray -t -- UNITS <<<"$FU"
for U in "${UNITS[@]}"; do
  if [[ -n "$U" ]]; then
    FAILED["$U"]=1
  fi
done

DIE=()
for R in "$RUN"/*.txt; do
  N="${R##*/}"
  N="${N%.txt}"
  if [[ -z "${FAILED["$N"]:-}" ]]; then
    DIE+=("$R")
  fi
done

rm -v --force --recursive -- "${DIE[@]}"

for U in "${!FAILED[@]}"; do
  journalctl --boot --lines 300 --unit "$U" | sponge -- "$RUN/$U.txt"
done

printf -v LINES -- '! -> %s\n' "${!FAILED[@]}"
printf -- '%s' "$LINES"

# if ((${#FAILED})); then
#   :
# fi
