.PHONY: tofu

facts tofu: facts/.env
facts/.env:
	touch -- '$@'

tofu: .terraform
.terraform:
	tofu init
