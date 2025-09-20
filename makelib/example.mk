.PHONY: example

example: ./facts/example.env ./facts/-.json ./facts/-.env
./facts/example.env: $(shell printf -- '%s ' ./{layers,machines}/*/usr/local/doc/examples/*.env)
	{
		cat -- /dev/null $^
		printf -- %s ENV_MACHINE=-
	} > '$@'

./facts/-.json ./facts/-.env:
	touch -- $@
