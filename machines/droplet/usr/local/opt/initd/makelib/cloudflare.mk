pkg._: /etc/apt/trusted.gpg.d/cloudflare.gpg
/etc/apt/trusted.gpg.d/cloudflare.gpg:
	$(CURL) -- 'https://pkg.cloudflareclient.com/pubkey.gpg' | sudo -- gpg --batch --dearmor --yes --output '$@'

