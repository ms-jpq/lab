.PHONY: compile

TS_PROJ := ./libexec/m4.sh $(shell shopt -u failglob && printf -- '%s ' ./{layers,machines}/**/tsconfig.json)

define LOCAL_TS_TEMPLATE
LOCAL.$1.FLAG := $1.lock

$(TMP)/$1.lock: ./node_modules/.bin $(TMP)/$1
	./node_modules/.bin/tsc --project '$(TMP)/$1'
	touch -- '$$@'
endef

$(foreach proj,$(TS_PROJ),$(eval $(call LOCAL_TS_TEMPLATE, proj)))
