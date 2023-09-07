#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O globstar

set -o pipefail

RUN="$1"
NFT="${0%/*}/../forwar.d"
SCRIPT="$RUN/tr.sed"
OLD="$RUN/old.conf"
NEW="$RUN/new.conf"

SED=()
for FILE in /run/local/dnsmasq/*/leases; do
  DOMAIN="${FILE%/*}"
  DOMAIN="${DOMAIN##*/}"
  LS="$(awk '{ print($1, $3, $4) }' "$FILE")"
  readarray -t -- LSS <<<"$LS"

  for LINE in "${LSS[@]}"; do
    EXP="${LINE%% *}"
    if [[ "$EXP" == 'duid' ]]; then
      continue
    fi

    LINE="${LINE#"$EXP" }"
    IP="${LINE%% *}"
    NAME="${LINE#"$IP" }"
    if [[ "$NAME" == '*' ]]; then
      continue
    fi

    if [[ "$IP" =~ : ]]; then
      SED+=("s/'$NAME.$DOMAIN.6'/$IP/p")
    else
      SED+=("s/'$NAME.$DOMAIN.4'/$IP/p")
    fi
  done
done

printf -- '%s\n' "${SED[@]}" >"$SCRIPT"

{
  cat -- "$NFT/0-flush.conf"
  sed --regexp-extended --quiet --file "$SCRIPT" "$NFT/1-elements.conf"
} >"$NEW"

if ! diff --brief -- "$OLD" "$NEW"; then
  mv -v -f -- "$NEW" "$OLD"
  nft --file "$OLD"
fi
