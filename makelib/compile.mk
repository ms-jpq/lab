.PHONY: compile clobber.compile

clobber: clobber.compile

TS_PROJECTS := $(patsubst ./%,%,$(shell shopt -u failglob && printf -- '%s\n' ./{layers,machines}/**/tsconfig.json))
TS_BUILDS :=

define COMPILE_TEMPLATE
TS_BUILDS += $(dir $1)tsconfig.tsbuildinfo

$(dir $1)tsconfig.tsbuildinfo: $1 tsconfig.json $(shell shopt -u failglob && printf -- '%s\n' $(dir $1)**/*.ts) | ./node_modules/.bin
	'./node_modules/.bin/tsc' --project '$1' --incremental --tsBuildInfoFile '$$@'
	touch -- '$$@'
endef

$(foreach project,$(TS_PROJECTS),$(eval $(call COMPILE_TEMPLATE,$(project))))

compile: $(TS_BUILDS)

clobber.compile:
	shopt -u failglob
	rm -v -f -- $(TS_BUILDS)
