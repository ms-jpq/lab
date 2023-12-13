.PHONY: fmt systemd-fmt shfmt black prettier nginx taplo

fmt: shfmt black prettier nginx taplo

# TODO: add ignore list -- systemd-fmt
systemd-fmt: $(VAR)/sh
	'$</layers/posix/home/.local/bin/systemd-fmt.sh' ./layers ./machines

shfmt: $(VAR)/bin/shfmt
	readarray -t -d $$'\0' -- ARRAY < <(git ls-files --deduplicate -z -- '*.sh')
	'$<' --write --indent 2 -- "$${ARRAY[@]}"

black: ./.venv/bin
	'$</isort' --profile=black --gitignore -- .
	'$</black' --extend-exclude pack -- .

prettier: ./node_modules/.bin
	'$</prettier' --cache --write -- .

nginx: ./node_modules/.bin
	'$</prettier' --cache --write --tab-width 2 --plugin ./node_modules/prettier-plugin-nginx/dist/index.js -- '**/*.nginx'

taplo: ./node_modules/.bin
	readarray -t -d $$'\0' -- ARRAY < <(git ls-files --deduplicate -z -- '*.toml')
	'$</taplo' format -- "$${ARRAY[@]}"
