.PHONY: nspawn nspawn.pull clobber.nspawn

all: nspawn
pull: nspawn.pull

/usr/lib/systemd/system/systemd-nspawn@.service: | pkg._

nspawn: /usr/local/lib/systemd/system/2-nspawnd@.service
/usr/local/lib/systemd/system/2-nspawnd@.service: /usr/lib/systemd/system/systemd-nspawn@.service
	sudo -- cp -v -f -- '$<' '$@'

clobber.nspawn:
	shopt -u failglob
	sudo -- rm -v -rf -- $(CACHE)/nspawn/*

TARBUNTU := https://cloud-images.ubuntu.com/releases/$(VERSION_ID)/release/ubuntu-$(VERSION_ID)-server-cloudimg-$(GOARCH)-root.tar.xz

$(CACHE)/nspawn/cloudimg.tar.xz:
	sudo -- mkdir -v -p -- '$(@D)'
	sudo -- $(CURL) --output '$@.part' -- '$(TARBUNTU)'
	sudo -- mv -v -f -- '$@.part' '$@'

nspawn.pull: $(CACHE)/nspawn/cloud.img
$(CACHE)/nspawn/cloud.img: $(CACHE)/nspawn/cloudimg.tar.xz
	sudo -- /usr/local/opt/nspawn/libexec/cloudimg-etl.sh '$<' '$@'
