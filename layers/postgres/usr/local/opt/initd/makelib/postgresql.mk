.PHONY: psql
all: psql

/usr/lib/postgresql: pkg._

define PSQL_TEMPLATE
psql: $1/conf.d

psql: $1/postgresql.conf
$1/postgresql.conf: /usr/local/opt/postgresql/postgresql.conf | /usr/bin/envsubst
	sudo -- env -- ID='$(notdir $1)' /usr/local/libexec/envsubst2.sh '$$<' '$$@'

psql: $1/conf.d
$1/conf.d:
	mkdir -v -p -- '$$@'

psql: /usr/local/etc/default/$(notdir $1).psql.env
/usr/local/etc/default/$(notdir $1).psql.env:
	touch -- '$$@'

psql: /var/lib/local/postgresql/$(notdir $1)
/var/lib/local/postgresql/$(notdir $1): | /usr/lib/postgresql
	/usr/local/opt/postgresql/libexec/initdb.sh '$(notdir $1)' '$$@'

endef


$(foreach cluster,$(patsubst %/,%,$(shell shopt -u failglob && printf -- '%s ' /usr/local/opt/postgresql/clusters/*/)),$(eval $(call PSQL_TEMPLATE,$(cluster))))
