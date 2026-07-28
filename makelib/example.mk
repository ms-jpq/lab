.PHONY: example

example: ./.facts/example.env ./.facts/-.json ./.facts/-.env
./.facts/example.env: $(shell printf -- '%s ' ./{layers,machines}/*/usr/local/doc/examples/*.env)
	FILES=($^)
	if grep --extended-regexp --line-number -v -e '^ENV_[A-Z0-9_]+=' -- "$${FILES[@]}"; then
	  exit 1
	fi
	cat -- /dev/null "$${FILES[@]}" > '$@'

./.facts/-.json ./.facts/-.env:
	touch -- $@
