#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

CLUSTER="$1"
PGDATA="$2"
BASE="${0%/*}"
USER=postgres

if find "$PGDATA" -type d -not -empty | grep -F -- "$PGDATA"; then
  exit 0
fi

RUN=(
  runuser
  --user "$USER"
  --
)

# https://www.postgresql.org/docs/current/app-initdb.html
# TODO: use icu @ PG 16
ARGV=(
  env --ignore-environment
  --
  TZ=Etc/UTC
  "$BASE/pg-path.sh" "$CLUSTER"
  initdb
  --pgdata "$PGDATA"
  --locale-provider icu
  --icu-locale zh_Hans_CN
  --locale zh_CN.UTF-8
)

# https://www.postgresql.org/docs/current/config-setting.html
RUNTIME="/run/local/postgresql/$CLUSTER"
OPTIONS=(
  cluster_name="$CLUSTER"
  external_pid_file="$RUNTIME/postgresql.pid"
  hba_file="$PGDATA/pg_hba.conf"
  ident_file="$PGDATA/pg_ident.conf"
  listen_addresses=''
  timezone='Etc/UTC'
  unix_socket_directories="$RUNTIME"
  unix_socket_permissions='0220'
)

for OPTION in "${OPTIONS[@]}"; do
  ARGV+=(--set "$OPTION")
done

/usr/local/libexec/fs-alloc.sh "$PGDATA"
chown -v -- "$USER:$USER" "$PGDATA"

"${RUN[@]}" "${ARGV[@]}"
"${RUN[@]}" mkdir -v -p -- "$PGDATA/conf.d"

if systemd-notify --booted; then
  systemctl start -- "postgresql@$CLUSTER"
  "$BASE/init-user.sh" "$CLUSTER"
fi
