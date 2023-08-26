.PHONY: nspawn

all: nspawn

/usr/lib/systemd/system/systemd-nspawn@.service: | pkg._

nspawn: /usr/local/lib/systemd/system/2-nspawnd@.service
/usr/local/lib/systemd/system/2-nspawnd@.service: /usr/lib/systemd/system/systemd-nspawn@.service
	cp -v -f -- '$<' '$@'

TARBUNTU := https://cloud-images.ubuntu.com/releases/$(VERSION_ID)/release/ubuntu-$(VERSION_ID)-server-cloudimg-$(GOARCH)-root.tar.xz

nspawn: /var/cache/local/nspawn/cloudimg.tar.xz
/var/cache/local/nspawn/cloudimg.tar.xz:
	curl --fail --location --create-dirs --output '$@' -- '$(TARBUNTU)' || rm -v -rf -- '$@'
