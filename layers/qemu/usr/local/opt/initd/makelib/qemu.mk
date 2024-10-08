.PHONY: qemu qemu.pull clobber.qemu

CLOUD_IMG_AT := https://cloud-images.ubuntu.com/releases/$(VERSION_ID)/release
KVMBUNTU := $(CLOUD_IMG_AT)/ubuntu-$(VERSION_ID)-server-cloudimg-$(GOARCH).img
QEMU_IMG := $(CACHE)/qemu/cloud.img/raw

pull: qemu.pull

all: /usr/local/lib/systemd/system/2-qemu-q35@.service

/usr/local/lib/systemd/system/2-qemu-q35@.service: /usr/local/lib/systemd/system/2-qemu-microvm@.service
	sudo -- cp -v -f -- '$<' '$@'

qemu: 2-qemu-q35@.service

clobber.qemu:
	shopt -u failglob
	sudo -- /usr/local/libexec/fs-dealloc.sh $(QEMU_IMG) $(CACHE)
	sudo -- rm -v -rf -- $(CACHE)/qemu/*

# pkg._: /etc/apt/sources.list.d/ppa_canonical-server_server-backports.list
/etc/apt/sources.list.d/ppa_canonical-server_server-backports.list:
	sudo -- ./libexec/add-ppa.sh canonical-server/server-backports

$(CACHE)/qemu/cloudimg.qcow2:
	sudo -- $(CURL) --output '$@' -- '$(KVMBUNTU)'

qemu.pull: $(QEMU_IMG)
$(QEMU_IMG): $(CACHE)/qemu/cloudimg.qcow2
	sudo -- /usr/local/opt/qemu/libexec/cloudimg-etl.sh '$<' '$@'


VIRTIO_WIN_IMG := https://fedorapeople.org/groups/virt/virtio-win/direct-downloads/stable-virtio/virtio-win.iso
qemu.pull: $(CACHE)/qemu/$(notdir $(VIRTIO_WIN_IMG))
$(CACHE)/qemu/$(notdir $(VIRTIO_WIN_IMG)):
	sudo -- $(CURL) --output '$@' -- '$(VIRTIO_WIN_IMG)'
