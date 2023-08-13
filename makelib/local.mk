.PHONY: local

MACHINE ?= _

./tmp/$(MACHINE): ./tmp

LAYERS := ./layers
LAYERS_DIRS := $(shell find $(LAYERS) -type d)
LAYERS_FILES := $(shell find $(LAYERS) -type f,l)


define LOCAL_D_TEMPLATE
$(patsubst $(LAYERS)%,%,$1)/: | $(patsubst $(LAYERS)%,%,$(dir $1))
	mkdir -v -p -- '$$@'
endef


define LOCAL_F_TEMPLATE
$(patsubst $(LAYERS)%,%,$(dir $1))$(patsubst !%,%,$(subst .erb.,.,$(notdir $1))): $1 | $(patsubst $(LAYERS)%,%,$(dir $1))
ifeq (!,$(findstring !,$1))
	cp -v -P -f -- '$$<' '$$@'
else
ifeq (.erb,$(suffix $(basename $1)))
	cd -- '$(dir $1)'
	./libexec/erb.rb '$$<' '$$@'
else
	cp -v -f -- '$$<' '$$@'
endif
endif
endef


$(foreach tpl,$(LAYERS_DIRS),$(eval $(call LOCAL_D_TEMPLATE,$(tpl))))
$(foreach tpl,$(LAYERS_FILES),$(eval $(call LOCAL_F_TEMPLATE,$(tpl))))
