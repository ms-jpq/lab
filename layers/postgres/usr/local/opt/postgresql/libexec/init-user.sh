#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

CLUSTER="$1"
SHADOW="/var/lib/local/postgresql/$CLUSTER/init.user"
ROLE="${CLUSTER#*'-'}"
shift -- 1

PSQL=(
  "${0%/*}/../bin/psql.sh" "$CLUSTER"
  --no-psqlrc
  --quiet
  --single-transaction
  --dbname postgres
  --no-align
  --tuples-only
  --file -
)

if [[ -v NUKE ]]; then
  "${PSQL[@]}" --set=role="$ROLE" <<- 'SQL'
DROP USER IF EXISTS :role;
SQL
fi

read -r -d '' -- USERS <<- 'SQL' || true
SELECT
  JSON_AGG(usename)
FROM
  pg_shadow;
SQL

if "${PSQL[@]}" <<< "$USERS" | jq --exit-status --arg role "$ROLE" '.[] | select(. == $role)'; then
  exit 0
fi

PASSWORD="$(openssl rand -base64 64 | tr -d -- '\n' | tr -- '/' '-')"
export -- PASSWORD

# TODO: use :pass @ PG 16, \getenv is undefined in 14
# --command '\getenv pass PASSWORD'
"${PSQL[@]}" --set=role="$ROLE" <<- SQL
CREATE USER :role
WITH
  SUPERUSER PASSWORD '$PASSWORD';
SQL

printf -- '%s\n' "$ROLE -> $PASSWORD" | runuser --user postgres -- sponge -- "$SHADOW"
