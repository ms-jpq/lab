.PHONY: compile

TS_PROJ := ./libexec/m4.sh $(shell printf -- '%s ' ./{layers,machines}/**/tsconfig.json)
