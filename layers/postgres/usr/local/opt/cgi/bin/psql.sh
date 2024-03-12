#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O globstar

set -o pipefail

if [[ ! -t 1 ]]; then
  exec <&3 >&3
fi

HOST="$HOSTNAME"
while read -r LINE; do
  LINE="${LINE%$'\r'}"
  if [[ -z "$LINE" ]]; then
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

tee -- <<-'EOF'
HTTP/1.0 200 OK
Content-Type: text/plain; charset=utf-8

EOF

for F in /var/lib/local/postgresql/*/init.user; do
  NAME="${F%/*}"
  NAME="${NAME##*/}"
  printf -- '%s\n' "$NAME"
  LINE="$(<"$F")"
  NAME="${LINE%%' '*}"
  PASSWD="$(cut --delimiter ' ' --fields 3- <<<"$LINE")"
  PASS="$(jq --exit-status --raw-input --raw-output '@uri' <<<"$PASSWD")"
  printf -v PSQL -- '%q ' psql -- "postgres://$NAME:$PASS@$HOST/$NAME"
  printf -- '%s\n' "postgres://$NAME:$PASSWD@$HOST/$NAME" "$PSQL"
  /usr/local/libexec/hr.sh
  printf -- '\n'
done

/usr/local/libexec/hr-run.sh systemctl --no-pager status --lines 0 -- 'postgresql@*.service' || true
