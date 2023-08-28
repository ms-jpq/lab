.PHONY: facts

MACHINES := $(patsubst %/,%,$(shell printf -- '%s ' machines/*/))
INVENTORY := ./inventory.json
SH_ENV := $(VAR)/sh/libexec/env.sh

FACT_MACHINES := $(shell ./libexec/inventory.sh --action ls --inventory '$(INVENTORY)')
FACTS := $(shell shopt -u failglob && printf -- '%s ' ./facts/example*.env)

facts: $(INVENTORY)
$(INVENTORY):
	touch -- '$@'


define FACT_TEMPLATE
facts: $(TMP)/machines/$1/mach.env
$(TMP)/machines/$1/mach.env: ./libexec/inventory.sh $(SH_ENV) $(INVENTORY) | $(TMP)/machines/$1
	'$$<' --action env --inventory '$(INVENTORY)' --machine '$1' -- '$(SH_ENV)' >'$$@'
endef


define NOFACT_TEMPLATE
facts: $(TMP)/machines/$1/mach.env
$(TMP)/machines/$1/mach.env: $(INVENTORY) | $(TMP)/machines/$1
	touch -- '$$@'
endef


$(foreach machine,$(FACT_MACHINES),$(eval $(call FACT_TEMPLATE,$(machine))))
$(foreach machine,$(filter-out $(FACT_MACHINES),$(patsubst machines/%,%,$(MACHINES))),$(eval $(call NOFACT_TEMPLATE,$(machine))))
