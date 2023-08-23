.PHONY: link

LINKS := $(shell find ./links -type f)

define LINK_TEMPLATE
LINKS.$1 := $(file <$1)

link: $(patsubst ./links/%,/%,$1)
$(patsubst ./links/%,/%,$1):
	mkdir -v -p -- '$$(@D)'
	ln -v -sf -- '$$(LINKS.$1)' '$$@'
endef

$(foreach link,$(LINKS),$(eval $(call LINK_TEMPLATE,$(link))))
