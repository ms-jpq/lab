.PHONY: fmt systemd-fmt shfmt black prettier nginx taplo terraform-fmt

fmt: systemd-fmt shfmt black prettier nginx taplo terraform-fmt

systemd-fmt: $(VAR)/sh
	export -- SYSTEMD_FMT_IGNORE
	SYSTEMD_FMT_IGNORE="$$(git ls-files -- '*/services/*.service')"
	'$</layers/posix/home/.local/bin/systemd-fmt.sh' layers machines

shfmt: $(VAR)/bin/shfmt
	git ls-files --deduplicate -z -- '*.sh' | xargs -r -0 -- '$<' --write --simplify --binary-next-line --space-redirects --indent 2 --

black: ./.venv/bin
	'$</isort' --profile=black --gitignore -- .
	'$</black' --extend-exclude pack -- .

prettier: ./node_modules/.bin
	'$</prettier' --cache --write -- .

nginx: ./node_modules/.bin
	'$</prettier' --cache --write --tab-width 2 --plugin ./node_modules/prettier-plugin-nginx/dist/index.js -- '**/*.nginx'

taplo: ./node_modules/.bin
	git ls-files --deduplicate -z -- '*.toml' | xargs -r -0 -- '$</taplo' format --

terraform-fmt: $(VAR)/bin/tofu
	git ls-files --deduplicate -z -- '*.tf' | xargs -r -0 -- '$<' fmt --write --
