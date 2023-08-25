.PHONY: examples

EXAMPLES := $(shell printf -- '%s ' ./layers/*/usr/local/share/doc/default/examples/*.env)

examples: ./machines/example.env
./machines/example.env: $(EXAMPLES)
	cat -- $^ > '$@'
