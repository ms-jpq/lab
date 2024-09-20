#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail
shopt -u failglob

BASE="${0%/*}"
RUN="$1"
NFT="$BASE/../forwar.d"
SCRIPT="$RUN/tr.sed"
OLD="$RUN/old.conf"
NEW="$RUN/new.conf"

LS="$("$BASE"/resolv-ip.sh)"
readarray -t -- LINES <<< "$LS"
SED=()
declare -A -- SEEN=()

for LINE in "${LINES[@]}"; do
  DOMAIN="${LINE%% *}"
  IP="${LINE##* }"
  if [[ $DOMAIN =~ \* ]]; then
    continue
  fi

  TR="$DOMAIN"
  TR="${TR//'.'/'\.'}"
  if [[ $IP =~ : ]]; then
    if [[ $IP =~ ^fd ]]; then
      STAT='i'
    else
      N=$((SEEN["$DOMAIN"]++))
      STAT="e$((N))"
    fi
    SED+=("s/'$TR:6$STAT'/$IP/p")
  else
    SED+=("s/'$TR:4'/$IP/p")
  fi
done

printf -- '%s\n' "${SED[@]}" > "$SCRIPT"

{
  cat -- "$NFT/0-flush.conf"
  sed --regexp-extended --quiet --file "$SCRIPT" "$NFT/1-elements.conf"
} > "$NEW"

if ! diff --brief -- "$OLD" "$NEW"; then
  mv -v -f -- "$NEW" "$OLD"
  nft --file "$OLD"
fi
