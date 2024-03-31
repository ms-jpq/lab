#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

if [[ ! -t 1 ]]; then
  exec <&3 >&3
fi

tee -- <<-'EOF'
HTTP/1.0 200 OK
Content-Type: text/plain; charset=utf-8

EOF

TMP=$(mktemp)

read -r -d '' -- AWK <<-'AWK' || true
BEGIN { command = "stdbuf --output L -- numfmt --to si --field 2-" }

{
  if (NR == 1) {
    print ">" $0
  }
  else if (/^\s+\w+(\s+[0-9]+)+$/) {
    print |& command
    command |& getline line
    print line
  }
  else { print }
}

END { close(command) }
AWK

SED=(
  sed -E
  -e '1s/[[:space:]]{2,}/%/g'
  -e '1s/[[:space:]]+/_/g'
  -e '1s/%/ /g'
)

show() {
  /usr/local/libexec/hr-run.sh tc -statistics qdisc show dev "$2" >"$TMP"
  readarray -t -- LINES <"$TMP"

  EMPTY=0
  M1=-1
  M2=-1
  for IDX in "${!LINES[@]}"; do
    if [[ "${LINES["$IDX"]}" =~ ^[[:space:]]*$ ]]; then
      case $((++EMPTY)) in
      1)
        M1=$((IDX + 1))
        ;;
      2)
        M2=$((IDX))
        ;;
      *) ;;
      esac
    fi
  done

  {
    printf -- '%s\n' "${LINES[@]:0:M1}"
    printf -- '%s\n' "${LINES[@]:M1:M2-M1}" | awk "$AWK" | "${SED[@]}" | column -t | pr --omit-pagination --indent=2
    printf -- '%s\n' "${LINES[@]:M2}"
  }
}

show RX cake-rx
# shellcheck disable=SC2154
show TX "$WAN_IF"
