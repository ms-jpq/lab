.PHONY: lint mypy shellcheck hadolint

lint: mypy shellcheck hadolint

mypy: ./.venv/bin
	git ls-files --deduplicate -z -- '*.py' | xargs -0 -- '$</mypy' --

shellcheck: $(VAR)/bin/shellcheck
	git ls-files --deduplicate -z -- '*.sh' | xargs -0 -- '$<' --

hadolint: $(VAR)/bin/hadolint
	git ls-files --deduplicate -z -- '*Dockerfile' | xargs -0 -- '$<' --
