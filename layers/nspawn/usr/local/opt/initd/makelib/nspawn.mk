.PHONY: nspawn nspawn.pull clobber.nspawn

NSPAWN_IMG := $(CACHE)/nspawn/cloud.img

all: nspawn
pull: nspawn.pull

/usr/lib/systemd/system/systemd-nspawn@.service: | pkg._

nspawn: /usr/local/lib/systemd/system/2-nspawnd@.service
/usr/local/lib/systemd/system/2-nspawnd@.service: /usr/lib/systemd/system/systemd-nspawn@.service
	sudo -- cp -v -f -- '$<' '$@'

clobber.nspawn:
	shopt -u failglob
	sudo -- /usr/local/opt/nspawn/libexec/fs-dealloc.sh $(NSPAWN_IMG) /var/lib/local
	sudo -- rm -v -rf -- $(CACHE)/nspawn/*

TARBUNTU := https://cloud-images.ubuntu.com/releases/$(VERSION_ID)/release/ubuntu-$(VERSION_ID)-server-cloudimg-$(GOARCH)-root.tar.xz

$(CACHE)/nspawn/cloudimg.tar.xz:
	sudo -- mkdir -v -p -- '$(@D)'
	sudo -- $(CURL) --output '$@' -- '$(TARBUNTU)'

nspawn.pull: $(NSPAWN_IMG)
$(NSPAWN_IMG): $(CACHE)/nspawn/cloudimg.tar.xz
	sudo -- /usr/local/opt/nspawn/libexec/cloudimg-etl.sh '$<' '$@'
