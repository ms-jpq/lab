.PHONY: psql
all: psql

/usr/lib/postgresql: pkg._

PSQL_CLUSTERS := /usr/local/etc/default/postgresql.env
PSQL_BOUNCER := /usr/local/opt/postgresql/pgbouncer.database.ini
PSQL_DATABASES := $(shell sed -E -e 's/^PG_CLUSTERS=(.*)/\1/' -e 's/,/ /g' -e 's#/#-#g' -- $(PSQL_CLUSTERS))

define PSQL_TEMPLATE
psql: /var/lib/local/postgresql/$1/PG_VERSION
/var/lib/local/postgresql/$1/PG_VERSION: | /usr/lib/postgresql $(PSQL_BOUNCER)
	sudo -- /usr/local/opt/postgresql/libexec/init-db.sh '$1' '$$(@D)'
endef

$(foreach cluster,$(PSQL_DATABASES),$(eval $(call PSQL_TEMPLATE,$(cluster))))

psql: $(PSQL_BOUNCER)
$(PSQL_BOUNCER): /usr/local/opt/postgresql/libexec/init-bouncer.sh $(PSQL_CLUSTERS)
	sudo -- '$<' '$@' $(PSQL_DATABASES)
