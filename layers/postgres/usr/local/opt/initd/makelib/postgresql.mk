.PHONY: psql
all: psql

/usr/lib/postgresql: pkg._

define PSQL_TEMPLATE
psql: /var/lib/local/postgresql/$1/PG_VERSION
/var/lib/local/postgresql/$1/PG_VERSION: | /usr/lib/postgresql
	/usr/local/opt/postgresql/libexec/init-db.sh '$1' '$$(@D)'
endef

PSQL_CLUSTERS := /usr/local/etc/default/postgresql.env
PSQL_DATABASES := $(shell sed -E -e 's/^PG_CLUSTERS=(.*)/\1/' -e 's/,/ /g' -e 's#/#-#g' -- $(PSQL_CLUSTERS))

$(foreach cluster,$(PSQL_DATABASES),$(eval $(call PSQL_TEMPLATE,$(cluster))))

psql: /usr/local/opt/postgresql/pgbouncer.database.ini
/usr/local/opt/postgresql/pgbouncer.database.ini: /usr/local/opt/postgresql/libexec/init-bouncer.sh $(PSQL_CLUSTERS)
	sudo -- '$<' '$@' $(PSQL_DATABASES)
