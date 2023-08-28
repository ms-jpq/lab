pkg._: /etc/apt/trusted.gpg.d/libcontainers.gpg
/etc/apt/trusted.gpg.d/libcontainers.gpg:
	$(CURL) -- 'https://download.opensuse.org/repositories/devel:kubic:libcontainers:unstable/xUbuntu_$(VERSION_ID)/Release.key' | sudo -- gpg --batch --dearmor --yes --output '$@'
