.PHONY: facts

ifeq ($(origin MACHINE), command line)
MACHINES := $(patsubst %,machines/%,$(MACHINE))
else
# MACHINES := $(patsubst %/,%,$(shell printf -- '%s ' machines/*/))
MACHINES :=
endif

INVENTORY := ./inventory.json
SH_ENV := $(VAR)/sh/libexec/env.sh

NPROC ?= 6

$(VAR)/sh/libexec/lsync.sh $(SH_ENV): | $(VAR)/sh
$(VAR)/sh: | $(VAR)
	if [[ -d '$@' ]]; then
		cd -- '$@'
		git pull --recurse-submodules --no-tags '--jobs=$(NPROC)'
	else
		git clone --recurse-submodules --shallow-submodules --depth=1 '--jobs=$(NPROC)' -- 'https://github.com/ms-jpq/shell_rc' '$@'
	fi

FACT_MACHINES := $(shell ./libexec/inventory.sh --action ls --inventory '$(INVENTORY)')
FACTS := $(shell shopt -u failglob && printf -- '%s ' ./facts/example*.env)

facts: $(INVENTORY)
$(INVENTORY): | ./libexec/inventory.sh
	'$|' --action gen --inventory '$(INVENTORY)'


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
