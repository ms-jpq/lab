.PHONY: tofu

tofu: .terraform

.terraform:
	tofu init
