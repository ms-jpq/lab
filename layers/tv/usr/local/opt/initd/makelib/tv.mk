pkg._: /etc/apt/sources.list.d/ppa_mozillateam_ppa.list
/etc/apt/sources.list.d/ppa_mozillateam_ppa.list:
	sudo -- ./libexec/add-ppa.sh mozillateam/ppa

# pkg._: /etc/apt/trusted.gpg.d/microsoft.gpg
# /etc/apt/trusted.gpg.d/microsoft.gpg:
# 	$(CURL) -- 'https://packages.microsoft.com/keys/microsoft.asc' | sudo -- gpg --batch --dearmor --yes --output '$@'

