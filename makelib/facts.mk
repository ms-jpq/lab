.PHONY: facts

INVENTORY := ./inventory.json
ENV_SH := $(VAR)/sh/libexec/env.sh

facts: $(INVENTORY)
$(INVENTORY):
	printf -- '%s\n' '{}' >'$@'

$(ENV_SH): $(VAR)/sh

ifeq ($(origin FACTS), command line)
FACT_MACHINES := $(FACTS)
else
FACT_MACHINES := $(shell ./libexec/inventory.sh --action ls --inventory '$(INVENTORY)')
endif

define FACT_TEMPLATE
facts: $(TMP)/machines/$1/env.json
$(TMP)/machines/$1/env.json: ./libexec/inventory.sh $(ENV_SH) $(INVENTORY) | $(TMP)/machines/$1
	'$$<' --action env --inventory '$(INVENTORY)' --machine '$1' -- '$(ENV_SH)' >'$$@'

endef

$(foreach machine,$(FACT_MACHINES),$(eval $(call FACT_TEMPLATE,$(machine))))
