.PHONY: compile clobber.compile

clobber: clobber.compile

TS_PROJECTS := $(shell shopt -u failglob && printf -- '%s\n' ./{layers,machines}/**/tsconfig.json)
TS_COMPILED :=
TS_TMP := $(TMP)/compile

$(TS_TMP): | $(TMP)
	mkdir -v -p -- '$@'

define COMPILE_TS_TEMPLATE
COMPILE.$1.DIR := $(TS_TMP)/$(patsubst ./%,%,$(patsubst %/,%,$(dir $1)))
COMPILE.$1.FLAG := $$(COMPILE.$1.DIR)/.compiled
COMPILE.$1.SOURCES := $(shell shopt -u failglob && printf -- '%s\n' $(dir $1)**/*.{cts,mts,ts,tsx})
TS_COMPILED += $$(COMPILE.$1.FLAG)

$$(COMPILE.$1.DIR): | $(TS_TMP)
	mkdir -v -p -- '$$@'

$$(COMPILE.$1.FLAG): $1 tsconfig.json package.json $$(COMPILE.$1.SOURCES) | ./node_modules/.bin $$(COMPILE.$1.DIR)
	'./node_modules/.bin/tsc' --project '$1'
	touch -- '$$@'
endef

$(foreach project,$(TS_PROJECTS),$(eval $(call COMPILE_TS_TEMPLATE,$(project))))

compile: $(TS_COMPILED)

clobber.compile:
	shopt -u failglob
	rm -v -rf -- '$(TS_TMP)'
