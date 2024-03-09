#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

DB="$1"
SHADOW="$2"
shift -- 1

PSQL=(
  psql
  --no-psqlrc
  --quiet
  --single-transaction
  --username postgres
  --dbname "$DB"
  --command '\a'
  --command '\t'
  --file -
)

if [[ -v NUKE ]]; then
  "${PSQL[@]}" --set=role="$DB" <<-'SQL'
DROP USER IF EXISTS :role;
SQL
fi

read -r -d '' -- USERS <<-'SQL' || true
SELECT
  JSON_AGG(usename)
FROM
  pg_shadow;
SQL

if "${PSQL[@]}" <<<"$USERS" | jq --exit-status --arg db "$DB" '.[] | select(. == $db)'; then
  exit 0
fi

PASSWORD="$(wg genpsk)"
export -- PASSWORD

# TODO: use :pass @ PG 16, \getenv is undefined in 14
# --command '\getenv pass PASSWORD'
"${PSQL[@]}" --set=role="$DB" <<-SQL
CREATE USER :role
WITH
  PASSWORD '$PASSWORD';
SQL

printf -- '%s\n' "$DB -> $PASSWORD" | tee -- "$SHADOW"
