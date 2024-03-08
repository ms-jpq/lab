.PHONY: psql
all: psql

define PSQL_TEMPLATE
psql: /var/lib/local/postgresql/$(subst -,/,$(notdir $1))
/var/lib/local/postgresql/$(subst -,/,$(notdir $1)):
	mkdir -v -p -- '$$@'

endef


$(foreach cluster,$(patsubst %/,%,$(shell shopt -u failglob && printf -- '%s ' /usr/local/opt/postgresql/conf/*/)),$(eval $(call PSQL_TEMPLATE,$(cluster))))
