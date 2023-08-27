.PHONY: pkg pkg._

pkg: pkg._
pkg._: ./libexec/pkg.sh
	'$<'

/bin/batcat /bin/fdfind: | pkg._
pkg: | /usr/local/bin/bat /usr/local/bin/fd

/usr/local/bin/bat: | /bin/batcat
	sudo -- ln -v -sf -- '$|' '$@'

/usr/local/bin/fd: | /bin/fdfind
	sudo -- ln -v -sf -- '$|' '$@'
