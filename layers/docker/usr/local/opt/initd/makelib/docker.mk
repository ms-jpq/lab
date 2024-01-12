.PHONY: docker clobber.docker

docker: all
	/usr/local/opt/docker-compose/libexec/up.sh

clobber.docker:
	docker system prune --all --force

pkg._: /etc/apt/trusted.gpg.d/docker.gpg
/etc/apt/trusted.gpg.d/docker.gpg:
	$(CURL) -- 'https://download.docker.com/linux/ubuntu/gpg' | sudo -- gpg --batch --dearmor --yes --output '$@'
