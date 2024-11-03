#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail
shopt -u failglob

read -r -d '' -- A1 <<- 'AWK' || true
$4 { printf("%s.%s.%s.home.arpa %s\n", $4, ETH, HOSTNAME, $3) }
AWK

read -r -d '' -- A2 <<- 'AWK' || true
!seen[$2]++ {
  n = split($1, dns, ".")
  for (i=n; i!=0; i--) printf "%s", dns[i] (i==1 ? "" : ".")
  print " " $1 " " $2
}
AWK

TMP="$(mktemp)"
for FILE in /run/local/dnsmasq/*/leases; do
  ETH="${FILE%/*}"
  ETH="${ETH##*/}"
  DOMAIN="$ETH.$HOSTNAME.home.arpa"
  # shellcheck disable=SC1090
  source -- "/run/local/ip/$ETH.env"
  LS="$(awk -- '$4 ~ /[^*]/ { print $4 }' "$FILE" | sort --unique)"
  awk -v "ETH=$ETH" -v "HOSTNAME=$HOSTNAME" -- "$A1" "$FILE" >> "$TMP"
  readarray -t -- LINES <<< "$LS"
  for LINE in "${LINES[@]}"; do
    if [[ -n $LINE ]]; then
      # shellcheck disable=SC2154
      printf -- '%s\0' "@$IPV6_ADDR" +short "$LINE.$DOMAIN" AAAA
    fi
  done
done | RECURSION=1 HOME=/tmp parallel -0 --max-replace-args 4 --tag dig | awk -- '{ print $3 " " $5 }' >> "$TMP"

awk -- "$A2" "$TMP" | sort --key 1,3 | cut --delimiter ' ' --fields 2- | column --table
rm -fr -- "$TMP"
