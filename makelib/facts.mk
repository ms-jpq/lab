.PHONY: facts

facts: ./inventory.json
./inventory.json:
	printf -- '%s\n' '{}' >'$@'


ifeq ($(origin FACTS), command line)
FACT_MACHINES := $(FACTS)
else
FACT_MACHINES := $(patsubst machines/%,%,$(shell printf -- '%s ' machines/*))
endif


