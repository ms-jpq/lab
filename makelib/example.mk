.PHONY: example

EXAMPLES := $(shell printf -- '%s ' ./{layers,machines}/*/usr/local/share/doc/default/examples/*.env)

example: ./facts/example.env
./facts/example.env: $(EXAMPLES)
	cat -- /dev/null $^ >'$@'
