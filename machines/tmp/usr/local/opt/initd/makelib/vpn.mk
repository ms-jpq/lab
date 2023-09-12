pkg._: /etc/apt/trusted.gpg.d/nordvpn.asc

/etc/apt/trusted.gpg.d/nordvpn.asc:
		$(CURL) --output '$@' -- 'https://repo.nordvpn.com/gpg/nordvpn_public.asc'

show: | pkg._
	genconf.sh
