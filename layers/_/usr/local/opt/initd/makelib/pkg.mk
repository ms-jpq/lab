.PHONY: pkg pkg._

pkg: pkg._
pkg._: ./libexec/pkg.sh
	'$<'

pkg._: /etc/apt/trusted.gpg.d/ms-jpq.gpg
/etc/apt/trusted.gpg.d/ms-jpq.gpg:
	$(CURL) -- 'https://raw.githubusercontent.com/ms-jpq/deb/refs/heads/deb/pubkey.asc' | sudo -- gpg --batch --dearmor --yes --output '$@'

/usr/bin/unzip /usr/bin/envsubst /usr/bin/sponge /usr/bin/batcat /usr/bin/fdfind /usr/lib/systemd/network: | pkg._
pkg: | /usr/local/bin/bat /usr/local/bin/fd

/usr/local/bin/bat: | /usr/bin/batcat
	sudo -- ln -v -snf -- '$|' '$@'

/usr/local/bin/fd: | /usr/bin/fdfind
	sudo -- ln -v -snf -- '$|' '$@'
