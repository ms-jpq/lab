.PHONY: clobber.docker

clobber.docker:
	docker system prune --all --force

pkg._: /etc/apt/trusted.gpg.d/docker.gpg
/etc/apt/trusted.gpg.d/docker.gpg:
	$(CURL) -- 'https://download.docker.com/linux/ubuntu/gpg' | sudo -- gpg --batch --dearmor --yes --output '$@'
