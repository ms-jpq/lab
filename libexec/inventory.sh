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
BSH=(bash --norc --noprofile -Eeu -o pipefail -O dotglob -O nullglob -O extglob -O failglob -O globstar -c)
CONN=(ssh
  -o 'ControlMaster=auto'
  -o "ControlPath=$PWD/var/tmp/%r@%h:%p"
  -o 'ControlPersist=60'
)
RSY=(
  rsync
  --recursive
  --links
  --perms
  --keep-dirlinks
)

conn() {
  # shellcheck disable=SC2016
  JSON="$("${JQER[@]}" --arg key "$MACHINE" '.[$key] // {}' inventory.json)"
  set -x "${JQER[@]}"
  HOST="$("${JQER[@]}" '.host' <<<"$JSON")"
  PORT="$("${JQER[@]}" '.port // 22' <<<"$JSON")"
  USER="$("${JQER[@]}" '.user // "root"' <<<"$JSON")"
  set +x

  CONN+=(-p $((PORT)) -l "$USER")
  SSH=("${CONN[@]}" "$HOST")
  printf -v RSH -- '%q ' "${CONN[@]}"
  RSY+=(--rsh "$RSH" --)
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
  for m in machines/*; do
    m="${m#*/}"
    LEAF="$("${JQE[@]}" --arg val "$m" '.host = $val' <<<"$JSON")"
    ACC="$("${JQE[@]}" --arg key "$m" --argjson val "$LEAF" '.[$key] = .[$key] // $val' <<<"$ACC")"
  done
  printf -- '%s\n' "$ACC" >"$INVENTORY"
  "${JQE[@]}" <<<"$ACC"
  ;;
ls)
  if [[ -f "$INVENTORY" ]]; then
    "${JQER[@]}" '. // {} | keys[]' "$INVENTORY"
  fi
  ;;
env)
  SCRIPT="$1"
  conn
  STR="$(printf -- '%q ' "${BSH[@]}" "$(<"$SCRIPT")")"
  ENV="$("${SSH[@]}" "$STR")"
  readarray -t -d $'\n' -- ROWS <<<"$ENV"

  ACC='{}'
  for ROW in "${ROWS[@]}"; do
    KEY="${ROW%%=*}"
    KEY="${KEY#'ENV_'}"
    VAL="${ROW#*=}"
    # shellcheck disable=SC2016
    ACC="$("${JQE[@]}" --arg key "${KEY,,}" --arg val "$VAL" '.[$key] = $val' <<<"$ACC")"
  done
  "${JQE[@]}" <<<"$ACC"

  ;;
sync)
  conn
  SRC="$1" DST="$HOST:$2"
  "${RSY[@]}" "$SRC" "$DST"
  ;;
exec)
  conn
  "${SSH[@]}" "$@"
  ;;
*)
  exit 2
  ;;
esac
