MACHINE := $(MACHINE)

./tmp/$(MACHINE): ./tmp

TEMPLATE_FILES := $(shell printf -- '%s ' ./layers/**/*)

define LOCAL_TEMPLATE
ifeq (.erb,$(suffix $(basename $1)))

$(dir $1)$(patsubst !%,%,$(notdir $1)): $1
	./libexec/erb.rb '$$<' '$$@'

else

$(dir $1)$(patsubst !%,%,$(notdir $1)): $1
	./libexec/cp.sh '$$<' '$$@'

endif
endef

$(foreach tpl,$(TEMPLATE_FILES),$(eval $(call LOCAL_TEMPLATE,$(tpl))))

