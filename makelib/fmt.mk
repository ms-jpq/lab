.PHONY: fmt systemd-fmt shfmt black prettier taplo

fmt: systemd-fmt shfmt black prettier taplo

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

taplo: ./node_modules/.bin
	readarray -t -d $$'\0' -- ARRAY < <(git ls-files --deduplicate -z -- '*.toml')
	'$</taplo' format -- "$${ARRAY[@]}"
