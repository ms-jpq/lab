.PHONY: facts

MACHINES := $(shell printf -- '%s ' machines/*)
INVENTORY := ./inventory.json
ENV_SH := $(VAR)/sh/libexec/env.sh


ifeq ($(origin FACTS), command line)
FACT_MACHINES := $(FACTS)
else
FACT_MACHINES := $(shell ./libexec/inventory.sh --action ls --inventory '$(INVENTORY)')
endif


facts: $(INVENTORY)
$(INVENTORY):
	printf -- '%s\n' '{}' >'$@'

$(ENV_SH): $(VAR)/sh


define FACT_TEMPLATE
facts: $(TMP)/machines/$1/env.json
$(TMP)/machines/$1/env.json: ./libexec/inventory.sh $(ENV_SH) $(INVENTORY) | $(TMP)/machines/$1
	'$$<' --action env --inventory '$(INVENTORY)' --machine '$1' -- '$(ENV_SH)' >'$$@'
endef


define NOFACT_TEMPLATE
$(TMP)/machines/$1/env.json: $(INVENTORY) | $(TMP)/machines/$1
	printf -- '%s\n' '{}' >'$$@'
endef


$(foreach machine,$(FACT_MACHINES),$(eval $(call FACT_TEMPLATE,$(machine))))
$(foreach machine,$(filter-out $(FACT_MACHINES),$(patsubst machines/%,%,$(MACHINES))),$(eval $(call NOFACT_TEMPLATE,$(machine))))
