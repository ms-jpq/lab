.PHONY: example

example: ./facts/example.env
./facts/example.env: $(shell printf -- '%s ' ./{layers,machines}/*/usr/local/doc/examples/*.env)
	cat -- /dev/null $^ >'$@'
