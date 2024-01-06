.PHONY: fmt systemd-fmt shfmt black prettier nginx taplo terraform-fmt

fmt: systemd-fmt shfmt black prettier nginx taplo

systemd-fmt: $(VAR)/sh
	export -- SYSTEMD_FMT_IGNORE
	SYSTEMD_FMT_IGNORE="$$(git ls-files -- '*/services/*.service')"
	'$</layers/posix/home/.local/bin/systemd-fmt.sh' layers machines

shfmt: $(VAR)/bin/shfmt
	git ls-files --deduplicate -z -- '*.sh' | xargs -0 -- '$<' --write --indent 2 --

black: ./.venv/bin
	'$</isort' --profile=black --gitignore -- .
	'$</black' --extend-exclude pack -- .

prettier: ./node_modules/.bin
	'$</prettier' --cache --write -- .

nginx: ./node_modules/.bin
	'$</prettier' --cache --write --tab-width 2 --plugin ./node_modules/prettier-plugin-nginx/dist/index.js -- '**/*.nginx'

taplo: ./node_modules/.bin
	git ls-files --deduplicate -z -- '*.toml' | xargs -0 -- '$</taplo' format --

terraform-fmt:
	git ls-files --deduplicate -z -- '*.tf' | xargs -0 -- terraform fmt --write --
