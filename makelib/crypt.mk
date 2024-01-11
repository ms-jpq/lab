.PHONY: encrypt

CRIP := ./sym.gpg
GPG := $(shell shopt -u failglob && printf -- '%s ' ./facts/*.gpg)

$(patsubst %.gpg,%,$(GPG)) &: $(CRIP) $(GPG)
	./libexec/decrypt.sh $^

$(CRIP):
	openssl genrsa 4096 | gpg --batch --default-recipient-self --encrypt --output '$@'

encrypt: $(CRIP)
	./libexec/encrypt.sh '$<' ./facts/*.env
