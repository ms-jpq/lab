.PHONY: example

example: ./facts/example.env ./facts/-.json ./facts/-.env
./facts/example.env: $(shell printf -- '%s ' ./{layers,machines}/*/usr/local/doc/examples/*.env)
	cat -- /dev/null $^ >'$@'

./facts/-.json ./facts/-.env:
	touch -- $@
