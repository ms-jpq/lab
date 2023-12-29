# pkg._: /etc/apt/sources.list.d/ppa_graphics-drivers_ppa.list

# /etc/apt/sources.list.d/ppa_graphics-drivers_ppa.list:
# 	sudo -- ./libexec/add-ppa.sh graphics-drivers/ppa

pkg._: /etc/apt/trusted.gpg.d/cuda.gpg
/etc/apt/trusted.gpg.d/cuda.gpg: | /usr/local/opt/cuda/libexec/gpg.sh
	LINK="$$('$|')"
	$(CURL) -- "$$LINK" >'$@'
