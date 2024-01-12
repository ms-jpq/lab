.PHONY: pkg.flatpak
pkg: pkg.flatpak

/usr/bin/flatpak: | pkg._
pkg.flatpak: | /usr/bin/flatpak
	./libexec/flatpak.sh
