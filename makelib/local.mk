.PHONY: local

e :=
s := ,
sp := $(e) $(e)

MACHINES := $(shell printf -- '%s ' machines/*)
local: facts

define LOCAL_TEMPLATE
LOCALS.$1 :=

MACH.$1.LAYERS := layers/{$(subst $(sp),$(s),$(strip $(shell tr '\n' ' ' <'$(machine)/layers.txt')))}
MACH.$1.DIRS := $$(shell find $$(MACH.$1.LAYERS) -type d)
MACH.$1.FILES := $$(shell find $$(MACH.$1.LAYERS) -type f,l)

$(TMP)/$1/./: | $(TMP)/$1
$(TMP)/$1: | $(TMP)
	mkdir -v -p -- '$$@'
$(TMP)/$1/layers/: | $(TMP)/$1
	mkdir -v -p -- '$$@'


$(TMP)/$1/facts.json: | $(TMP)/$1
	./libexec/facts.sh '$1' >'$$@'


$$(foreach layer,$$(MACH.$1.DIRS),$$(eval $$(call LOCAL_D_TEMPLATE,$1,$$(layer))))
$$(foreach layer,$$(MACH.$1.FILES),$$(eval $$(call LOCAL_F_TEMPLATE,$1,$$(layer))))


local: $(TMP)/$1/fs

$(TMP)/$1/fs: $$(LOCALS.$1)
	mkdir -v -p -- '$$@'
	for layer in $(TMP)/$1/layers/*/; do
		rsync --recursive --links --perms --keep-dirlinks "$$$$layer" '$$@/'
	done
	touch -- '$$@'
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


$(foreach machine,$(MACHINES),$(eval $(call LOCAL_TEMPLATE,$(machine))))
