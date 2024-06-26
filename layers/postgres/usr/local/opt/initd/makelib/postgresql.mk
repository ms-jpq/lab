.PHONY: psql
all: psql

pkg._: /etc/apt/trusted.gpg.d/pgdg.asc
/etc/apt/trusted.gpg.d/pgdg.asc:
	sudo -- $(CURL) --output '$@' -- 'https://www.postgresql.org/media/keys/ACCC4CF8.asc'

/usr/lib/postgresql: pkg._

PSQL_CLUSTERS := /usr/local/etc/default/postgresql.env
PSQL_DATABASES := $(shell sed -E -e 's/^PG_CLUSTERS=(.*)/\1/' -e 's/,/ /g' -e 's#/#-#g' -- $(PSQL_CLUSTERS))

define PSQL_TEMPLATE
psql: /var/lib/local/postgresql/$1/PG_VERSION
/var/lib/local/postgresql/$1/PG_VERSION: | /usr/lib/postgresql
	sudo -- /usr/local/opt/postgresql/libexec/init-db.sh '$1' '$$(@D)'
endef

$(foreach cluster,$(PSQL_DATABASES),$(eval $(call PSQL_TEMPLATE,$(cluster))))

psql: /usr/local/opt/postgresql/pgbouncer.database.ini
/usr/local/opt/postgresql/pgbouncer.database.ini: /usr/local/opt/postgresql/libexec/init-bouncer.sh /usr/local/opt/postgresql/pgbouncer.ini $(PSQL_CLUSTERS)
	sudo -- '$<' '$@' $(PSQL_DATABASES)
