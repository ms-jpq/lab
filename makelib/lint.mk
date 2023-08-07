.PHONY: lint rubocop mypy shellcheck hadolint

lint: rubocop mypy shellcheck hadolint

rubocop: ./vendor
	bundle exec -- rubocop -- .

mypy: ./.venv/bin
	'$</mypy' -- .

shellcheck: ./var/bin/shellcheck
	readarray -t -d $$'\0' -- ARRAY < <(git ls-files --deduplicate -z -- '*.sh')
	'$<' -- "$${ARRAY[@]}"

hadolint: ./var/bin/hadolint
	readarray -t -d $$'\0' -- ARRAY < <(git ls-files --deduplicate -z -- '*Dockerfile')
	'$<' -- "$${ARRAY[@]}"
