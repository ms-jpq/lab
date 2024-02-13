.PHONY: lint mypy shellcheck hadolint tflint

lint: mypy shellcheck hadolint tflint

mypy: ./.venv/bin
	git ls-files --deduplicate -z -- '*.py' | xargs -r -0 -- '$</mypy' --

shellcheck: $(VAR)/bin/shellcheck
	git ls-files --deduplicate -z -- '*.sh' | xargs -r -0 -- '$<' --

hadolint: $(VAR)/bin/hadolint
	git ls-files --deduplicate -z -- '*Dockerfile' | xargs -r -0 -- '$<' --

tflint: $(VAR)/bin/tflint $(VAR)/tflint.d
	printf -- '%s\0' ./terraform/*/ | xargs -r -0 -n 1 -P 0 -- '$<' --chdir
