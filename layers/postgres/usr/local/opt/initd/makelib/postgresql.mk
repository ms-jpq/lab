.PHONY: psql
all: psql

define PSQL_TEMPLATE
psql: $1/conf.d

psql: $1/conf.d
$1/conf.d:
	mkdir -v -p -- '$$@'

psql: /usr/local/etc/default/$(notdir $1).psql.env
/usr/local/etc/default/$(notdir $1).psql.env:
	touch -- '$$@'

psql: /var/lib/local/postgresql/$(subst -,/,$(notdir $1))
/var/lib/local/postgresql/$(subst -,/,$(notdir $1)):
	mkdir -v -p -- '$$@'

endef


$(foreach cluster,$(patsubst %/,%,$(shell shopt -u failglob && printf -- '%s ' /usr/local/opt/postgresql/conf/*/)),$(eval $(call PSQL_TEMPLATE,$(cluster))))
