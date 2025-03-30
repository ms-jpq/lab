pkg._: /etc/apt/trusted.gpg.d/tvheadend.gpg
/etc/apt/trusted.gpg.d/tvheadend.gpg:
	$(CURL) -- 'https://dl.cloudsmith.io/public/tvheadend/tvheadend/gpg.C6CC06BD69B430C6.key' | sudo -- gpg --batch --dearmor --yes --output '$@'
