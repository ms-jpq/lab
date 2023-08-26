.PHONY: pkg pkg._

pkg: pkg._
pkg._: ./libexec/pkg.sh
	'$<'

APT_INSTALL := DEBIAN_FRONTEND=noninteractive sudo --preserve-env -- apt-get install --yes
APT_DEPS := /etc/ssl/certs/ca-certificates.crt /usr/bin/curl /usr/bin/gpg /usr/bin/jq /usr/bin/git /usr/share/doc/python3-venv

/usr/bin/unzip:
	APT=(ca-certificates curl gnupg jq git unzip python3-venv)
	sudo -- apt-get update
	$(APT_INSTALL) -- "$${APT[@]}"

/bin/batcat /bin/fdfind: | pkg._
pkg: | /usr/local/bin/bat /usr/local/bin/fd

/usr/local/bin/bat: | /bin/batcat
	sudo -- ln -v -sf -- '$|' '$@'

/usr/local/bin/fd: | /bin/fdfind
	sudo -- ln -v -sf -- '$|' '$@'

$(APT_DEPS): | /usr/bin/unzip
