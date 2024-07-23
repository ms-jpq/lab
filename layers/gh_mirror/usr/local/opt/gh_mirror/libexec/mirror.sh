#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

ACCOUNT="$2"
STORE="$1/$ACCOUNT"
NPROC=6

SED=(sed -E -n)
readarray -t -d ',' -- KILL <<< "${MIRROR_IGNORE:-""}"

for K in "${KILL[@]}"; do
  K="${K%$'\n'}"
  if [[ -z $K ]]; then
    continue
  fi
  SED+=(-e "/^$(sed -E -e 's#([.\/])#\\\1#g' <<< "https://github.com/$ACCOUNT/$K.git")$/d")
done
SED+=(-e 'p')

"${0%/*}/ls-repos.sh" "$ACCOUNT" | "${SED[@]}" | shuf | xargs --no-run-if-empty -L 1 -P "$NPROC" -- "${0%/*}/mirror-repo.sh" "$STORE"
