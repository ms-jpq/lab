.PHONY: facts

facts: ./inventory.json
./inventory.json:
	printf -- '%s\n' '{}' >'$@'

