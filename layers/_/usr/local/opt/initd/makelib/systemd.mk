.PHONY: systemd

pkg._: systemd


define SYSTEMD_MASK_TEMPLATE

systemd: | /usr/local/lib/systemd/system/$1
/usr/local/lib/systemd/system/$1:
	mkdir -v -p -- '$$(@D)'
	ln -v -sf -- /dev/null '$$@'

endef

define SYSTEMD_ENABLE_TEMPLATE

systemd: | /usr/local/lib/systemd/system/$1$(notdir $2)
/usr/local/lib/systemd/system/$1$(notdir $2): | $2
	mkdir -v -p -- '$$(@D)'
	ln -v -sf -- '$$|' '$$@'

endef


$(foreach mask,$(shell cat -- ./systemd/masked/*.txt),$(eval $(call SYSTEMD_MASK_TEMPLATE,$(mask))))
$(foreach conf,$(shell find ./systemd/enabled -type f),$(foreach c,$(shell cat -- '$(conf)'),$(eval $(call SYSTEMD_ENABLE_TEMPLATE,$(patsubst ./systemd/enabled/%,%,$(dir $(conf))),$(c)))))
