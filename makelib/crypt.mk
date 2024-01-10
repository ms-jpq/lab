.PHONY: encrypt

GPG := $(shell shopt -u failglob && printf -- '%s ' ./facts/*.gpg)

define DECRYPT_TEMPLATE
$(patsubst %.gpg,%,$1): $1
	rm -v -fr -- '$$@'
	flock $(VAR) gpg --batch --decrypt-files -- '$$<'
endef

$(foreach gpg,$(GPG),$(eval $(call DECRYPT_TEMPLATE,$(gpg))))

encrypt:
	rm -v -fr -- $(GPG)
	gpg --batch --default-recipient-self --encrypt-files -- ./facts/*.env
