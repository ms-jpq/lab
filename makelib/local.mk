.PHONY: local

MACHINES := $(shell printf -- '%s ' machines/*)

LAYERS_DIRS := $(shell find layers -type d)
LAYERS_FILES := $(shell find layers -type f,l)


define LOCAL_PRE_TEMPLATE
LOCALS.$1 :=

$(TMP)/$1/./: | $(TMP)/$1
$(TMP)/$1: | $(TMP)
	mkdir -v -p -- '$$@'

$(TMP)/$1/facts.json: | $(TMP)/$1
	./libexec/facts.sh '$1' >'$$@'
endef


define LOCAL_D_TEMPLATE
$(TMP)/$1/$2/: | $(TMP)/$1/$(dir $2)
	mkdir -v -p -- '$$@'
endef


define LOCAL_F_TEMPLATE
LOCALS.$1 += $(TMP)/$1/$(dir $2)$(patsubst !%,%,$(subst .erb.,.,$(notdir $2)))

$(TMP)/$1/$(dir $2)$(patsubst !%,%,$(subst .erb.,.,$(notdir $2))): $2 $(TMP)/$1/facts.json | $(TMP)/$1/$(dir $2)
ifeq (!,$(findstring !,$2))
	cp -v -f -- '$$<' '$$@'
else
ifeq (.erb,$(suffix $(basename $2)))
	./libexec/erb.rb '$$<' '$$@' <'$(TMP)/$1/facts.json'
else
	cp -v -P -f -- '$$<' '$$@'
endif
endif
endef


define LOCAL_POST_TEMPLATE
local: $(TMP)/$1/fs

$(TMP)/$1/fs: $$(LOCALS.$1)
	mkdir -v -p -- '$$@'
	for layer in $(TMP)/$1/layers/*/; do
		rsync --recursive --links --perms --keep-dirlinks "$$$$layer" '$$@/'
	done
	touch -- '$$@'

endef


$(foreach machine,$(MACHINES),$(eval $(call LOCAL_PRE_TEMPLATE,$(machine))))
$(foreach machine,$(MACHINES),$(foreach layer,$(LAYERS_DIRS),$(eval $(call LOCAL_D_TEMPLATE,$(machine),$(layer)))))
$(foreach machine,$(MACHINES),$(foreach layer,$(LAYERS_FILES),$(eval $(call LOCAL_F_TEMPLATE,$(machine),$(layer)))))
$(foreach machine,$(MACHINES),$(eval $(call LOCAL_POST_TEMPLATE,$(machine))))
