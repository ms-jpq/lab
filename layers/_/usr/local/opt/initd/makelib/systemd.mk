.PHONY: systemd.mask

pkg._: systemd.mask


define SYSTEMD_MASK_TEMPLATE

systemd.mask: | /usr/local/lib/systemd/system/$1
/usr/local/lib/systemd/system/$1:
	mkdir -v -p -- '$$(@D)'
	ln -v -sf -- /dev/null '$$@'

endef

$(foreach mask,$(shell cat -- ./systemd/masked/*.txt),$(eval $(call SYSTEMD_MASK_TEMPLATE,$(mask))))
