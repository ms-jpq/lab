.PHONY: ci

ci: lint build
	make fmt
	git diff --exit-code

