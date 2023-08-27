.PHONY: flatpak
pkg: flatpak

/usr/bin/flatpak: | pkg._
flatpak: | /usr/bin/flatpak
	./libexec/flatpak.sh
