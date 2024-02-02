# pkg._: /etc/apt/sources.list.d/ppa_graphics-drivers_ppa.list

# /etc/apt/sources.list.d/ppa_graphics-drivers_ppa.list:
# 	sudo -- ./libexec/add-ppa.sh graphics-drivers/ppa

CUDA_GPG := /etc/apt/trusted.gpg.d/cuda.gpg

pkg._: $(CUDA_GPG)
$(CUDA_GPG): | /usr/local/opt/cuda/libexec/gpg.sh
	LINK="$$('$|')"
	$(CURL) -- "$$LINK" >'$@'

$(CACHE)/nspawn/cloud.img: | $(CUDA_GPG)
