.PHONY: examples

EXAMPLES := $(shell printf -- '%s ' ./layers/*/usr/local/share/doc/default/examples/*.env)

examples: ./facts/example.env
./facts/example.env: $(EXAMPLES)
	cat -- $^ > '$@'
