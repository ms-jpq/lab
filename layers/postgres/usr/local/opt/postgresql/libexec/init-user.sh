#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

CLUSTER="$1"
SHADOW="$2"
ROLE="${CLUSTER#*'-'}"
shift -- 1

PSQL=(
  "${0%/*}/../bin/psql.sh" "$CLUSTER"
  --no-psqlrc
  --quiet
  --single-transaction
  --dbname postgres
  --command '\a'
  --command '\t'
  --file -
)

if [[ -v NUKE ]]; then
  "${PSQL[@]}" --set=role="$ROLE" <<-'SQL'
DROP USER IF EXISTS :role;
SQL
fi

read -r -d '' -- USERS <<-'SQL' || true
SELECT
  JSON_AGG(usename)
FROM
  pg_shadow;
SQL

if "${PSQL[@]}" <<<"$USERS" | jq --exit-status --arg role "$ROLE" '.[] | select(. == $role)'; then
  exit 0
fi

PASSWORD="$(openssl rand -base64 32 | tr -d -- '\n')"
export -- PASSWORD

# TODO: use :pass @ PG 16, \getenv is undefined in 14
# --command '\getenv pass PASSWORD'
"${PSQL[@]}" --set=role="$ROLE" <<-SQL
CREATE USER :role
WITH
  PASSWORD '$PASSWORD';
SQL

printf -- '%s\n' "$ROLE -> $PASSWORD" | sponge -- "$SHADOW"

CONN="$ROLE:$(jq --exit-status --raw-input --raw-output '@uri' <<<"$PASSWORD")"
printf -v PSQL -- '%q ' psql -- "postgres://$CONN@$HOSTNAME/$ROLE"
printf -- '%s\n' "$PSQL" >&2
