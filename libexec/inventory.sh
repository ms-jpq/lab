#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

cd -- "${0%/*}/.."

OPTS='a:,i:,m:'
LONG_OPTS='action:,inventory:,machine:'
GO="$(getopt --options="$OPTS" --longoptions="$LONG_OPTS" --name="$0" -- "$@")"
eval -- set -- "$GO"

while (($#)); do
  case "$1" in
  --)
    shift -- 1
    break
    ;;
  -a | --action)
    ACTION="$2"
    shift -- 2
    ;;
  -i | --inventory)
    INVENTORY="$2"
    shift -- 2
    ;;
  -m | --machine)
    MACHINE="$2"
    shift -- 2
    ;;
  *)
    exit 1
    ;;
  esac
done

JQE=(jq --exit-status)
JQER=("${JQE[@]}" --raw-output)
BSH=(bash --norc --noprofile -Eeuo pipefail -O dotglob -O nullglob -O extglob -O failglob -O globstar -c)
CONN=(ssh
  -o 'ControlMaster=auto'
  -o "ControlPath=$PWD/var/tmp/%r@%h:%p"
  -o 'ControlPersist=60'
)
RSY=(
  rsync
  --keep-dirlinks
  --recursive
  --links
  --perms
  --times
)

conn() {
  # shellcheck disable=SC2016
  JSON="$("${JQER[@]}" --arg key "$MACHINE" '.[$key] // {}' inventory.json)"
  HOST="$("${JQER[@]}" '.host' <<<"$JSON")"
  PORT="$("${JQER[@]}" '.port // 22' <<<"$JSON")"
  USER="$("${JQER[@]}" '.user // "root"' <<<"$JSON")"

  CONN+=(-p $((PORT)) -l "$USER")
  SSH=("${CONN[@]}" "$HOST")
  printf -v RSH -- '%q ' "${CONN[@]}"
  RSY+=(--rsh "$RSH" --)
}

shell() {
  local sh
  if [[ -v LOCAL ]]; then
    "$@"
  else
    conn
    printf -v sh -- '%q ' "$@"
    # shellcheck disable=SC2029
    "${SSH[@]}" "$sh"
  fi
}

case "$ACTION" in
gen)
  if [[ -f "$INVENTORY" ]]; then
    ACC="$(<"$INVENTORY")"
  else
    ACC='{}'
  fi

  read -r -d '' -- JSON <<-EOF || true
{
  "host": null,
  "port": 22,
  "user": "root"
}
EOF

  # shellcheck disable=SC2016
  for m in machines/*/; do
    m="${m#*/}"
    LEAF="$("${JQE[@]}" --arg val "$m" '.host = $val' <<<"$JSON")"
    ACC="$("${JQE[@]}" --arg key "$m" --argjson val "$LEAF" '.[$key] = .[$key] // $val' <<<"$ACC")"
  done
  printf -- '%s\n' "$ACC" >"$INVENTORY"
  "${JQE[@]}" <<<"$ACC"
  ;;
ls)
  if [[ -v LOCAL ]]; then
    MS='./machines/'
    for m in "$MS"*/; do
      m="${m#"$MS"}"
      printf -- '%s\n' "${m%/}"
    done
  fi
  if [[ -f "$INVENTORY" ]]; then
    "${JQER[@]}" '. // {} | keys[]' "$INVENTORY"
  fi
  ;;
env)
  SCRIPT="$1"
  shell "${BSH[@]}" "$(<"$SCRIPT")"
  ;;
sync)
  SRC="$1"
  DST="/"
  if [[ -v LOCAL ]]; then
    sudo -- "${RSY[@]}" "$SRC" "$DST"
  else
    conn
    "${RSY[@]}" "$SRC" "$HOST:$DST"
  fi
  ;;
exec)
  shell "${BSH[@]}" "$@"
  ;;
*)
  set -x
  exit 2
  ;;
esac
