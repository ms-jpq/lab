#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail
shopt -u failglob

if [[ ! -t 1 ]]; then
  exec <&3 >&3
fi

HOST="$HOSTNAME"
while read -r LINE; do
  LINE="${LINE%$'\r'}"
  if [[ -z $LINE ]]; then
    break
  fi

  LHS="${LINE%%:*}"
  KEY="${LHS,,}"
  case "$KEY" in
  host)
    HOST="${LINE##*: }"
    ;;
  *) ;;
  esac
done

tee -- <<- 'EOF'
HTTP/1.0 200 OK
Content-Type: text/plain; charset=utf-8

EOF

FQDN="$(hostname --all-fqdns | cut --delimiter ' ' --fields -1)"

for F in /var/lib/local/postgresql/*/init.user; do
  NAME="${F%/*}"
  NAME="${NAME##*/}"
  printf -- '%s\n' "$NAME"
  LINE="$(< "$F")"
  NAME="${LINE%%' : '*}"
  PASSWD="${LINE#*' : '}"
  PASS="$(jq --exit-status --raw-input --raw-output '@uri' <<< "$PASSWD")"
  printf -v PSQL1 -- '%q ' psql -- "postgres://$NAME:$PASS@$HOST/$NAME"
  printf -v PSQL2 -- '%q ' psql -- "postgres://$NAME:$PASS@$FQDN/$NAME"
  printf -- '%s\n' "postgres://$NAME:$PASSWD@$HOST/$NAME" "${PSQL1%' '*}" "${PSQL2%' '*}"
  /usr/local/libexec/hr.sh
  printf -- '\n'
done

/usr/local/libexec/hr-run.sh systemctl --no-pager status --lines 0 -- 'postgresql@*.service' || true
