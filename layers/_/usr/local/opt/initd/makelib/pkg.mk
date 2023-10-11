.PHONY: pkg pkg._

pkg: pkg._
pkg._: ./libexec/pkg.sh
	'$<'

/usr/bin/batcat /usr/bin/fdfind /usr/bin/unzip: | pkg._
pkg: | /usr/local/bin/bat /usr/local/bin/fd

/usr/local/bin/bat: | /usr/bin/batcat
	sudo -- ln -v -sf -- '$|' '$@'

/usr/local/bin/fd: | /usr/bin/fdfind
	sudo -- ln -v -sf -- '$|' '$@'
