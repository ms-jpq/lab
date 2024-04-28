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
  --locale C.UTF-8
)

true && exit

RUNTIME="/run/local/postgresql/$CLUSTER"
OPTIONS=(
  cluster_name="$CLUSTER"
  external_pid_file="$RUNTIME/postmaster.pid"
  hba_file="$PGDATA/pg_hba.conf"
  ident_file="$PGDATA/pg_ident.conf"
  include_dir="/usr/local/opt/postgresql/$CLUSTER/conf.d"
  listen_addresses=''
  stats_temp_directory='/tmp/pgstats'
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
ID="$CLUSTER" envsubst <"$BASE/../postgresql.conf" | "${RUN[@]}" sponge -- "$PGDATA/postgresql.conf"

if systemd-notify --booted; then
  systemctl start -- "postgresql@$CLUSTER"
  "$BASE/init-user.sh" "$CLUSTER"
fi
