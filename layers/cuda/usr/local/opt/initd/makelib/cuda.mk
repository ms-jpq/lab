# pkg._: /etc/apt/sources.list.d/ppa_graphics-drivers_ppa.list

# /etc/apt/sources.list.d/ppa_graphics-drivers_ppa.list:
# 	sudo -- ./libexec/add-ppa.sh graphics-drivers/ppa

# DO NOT ENABLE ^^^
# DO NOT ENABLE ^^^
# DO NOT ENABLE ^^^

# CUDA_GPG := /etc/apt/trusted.gpg.d/cuda.gpg
CUDA_CONTAINER_GPG := /etc/apt/trusted.gpg.d/nvidia-container-toolkit.gpg

# pkg._: $(CUDA_GPG)
# $(CUDA_GPG): | /usr/local/opt/cuda/libexec/gpg.sh
# 	LINK="$$('$|')"
# 	$(CURL) -- "$$LINK" >'$@'

pkg._: $(CUDA_CONTAINER_GPG)
$(CUDA_CONTAINER_GPG):
	$(CURL) -- 'https://nvidia.github.io/libnvidia-container/gpgkey' | sudo -- gpg --batch --dearmor --yes --output '$@'

# $(CACHE)/nspawn/cloud.img: | $(CUDA_GPG) $(CUDA_CONTAINER_GPG)
$(CACHE)/nspawn/cloud.img: | $(CUDA_CONTAINER_GPG)
