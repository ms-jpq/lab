.PHONY: docker clobber.docker

CLOBBER.FS += /etc/docker/*

/usr/bin/docker: | pkg._
docker: | /usr/bin/docker
	/usr/local/opt/docker-compose/libexec/up.sh

clobber.docker:
	docker system prune --all --force

pkg._: /etc/apt/trusted.gpg.d/docker.gpg
/etc/apt/trusted.gpg.d/docker.gpg:
	$(CURL) -- 'https://download.docker.com/linux/ubuntu/gpg' | sudo -- gpg --batch --dearmor --yes --output '$@'
