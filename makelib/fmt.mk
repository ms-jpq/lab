.PHONY: fmt shfmt stree black prettier taplo

fmt: shfmt stree black prettier taplo

shfmt: $(VAR)/bin/shfmt
	readarray -t -d $$'\0' -- ARRAY < <(git ls-files --deduplicate -z -- '*.sh')
	'$<' --write --indent 2 -- "$${ARRAY[@]}"

stree: ./vendor
	bundle exec -- stree write -- '**/.rb'
	bundle exec -- rubocop --fail-level=fatal --autocorrect -- .

black: ./.venv/bin
	'$</isort' --profile=black --gitignore -- .
	'$</black' --extend-exclude pack -- .

prettier: ./node_modules/.bin
	'$</prettier' --cache --write -- .

taplo: ./node_modules/.bin
	readarray -t -d $$'\0' -- ARRAY < <(git ls-files --deduplicate -z -- '*.toml')
	'$</taplo' format -- "$${ARRAY[@]}"
