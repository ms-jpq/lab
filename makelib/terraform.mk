.PHONY: tofu

define TERRAFORM_TEMPLATE
tofu: $(dir $1)/.terraform
$(dir $1)/.terraform: | $(VAR)/bin/tofu
	'$$|' -chdir='$$(@D)' get
endef

$(foreach tf, $(shell shopt -u failglob && printf -- '%s ' ./terraform/*/deps.tf),$(eval $(call TERRAFORM_TEMPLATE,$(tf))))
