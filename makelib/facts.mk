.PHONY: facts

INVENTORY := ./inventory.json

facts: $(INVENTORY)
$(INVENTORY):
	./libexec/inventory.sh gen >'$@'


ifeq ($(origin FACTS), command line)
FACT_MACHINES := $(FACTS)
else
FACT_MACHINES := $(shell ./libexec/inventory.sh ls $(INVENTORY))
endif

