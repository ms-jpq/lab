.PHONY: qemu qemu.grub qemu.pull clobber.qemu

CLOUD_IMG_AT := https://cloud-images.ubuntu.com/releases/$(VERSION_ID)/release
KERNEL := $(CLOUD_IMG_AT)/unpacked/ubuntu-$(VERSION_ID)-server-cloudimg-$(GOARCH)-vmlinuz-generic
INITRD := $(CLOUD_IMG_AT)/unpacked/ubuntu-$(VERSION_ID)-server-cloudimg-$(GOARCH)-initrd-generic
KVMBUNTU := $(CLOUD_IMG_AT)/ubuntu-$(VERSION_ID)-server-cloudimg-$(GOARCH).img
QEMU_IMG := $(CACHE)/qemu/cloud.img

pull: qemu.pull

all: /usr/local/lib/systemd/system/2-qemu-q35@.service

/usr/local/lib/systemd/system/2-qemu-q35@.service: /usr/local/lib/systemd/system/2-qemu-microvm@.service
	sudo -- cp -v -f -- '$<' '$@'

qemu: 2-qemu-q35@.service

qemu.grub:
	update-initramfs -u && update-grub

clobber.qemu:
	shopt -u failglob
	sudo -- /usr/local/opt/qemu/libexec/fs-dealloc.sh $(QEMU_IMG)
	sudo -- rm -v -rf -- $(CACHE)/qemu/*

pkg._: /etc/apt/sources.list.d/ppa_canonical-server_server-backports.list
/etc/apt/sources.list.d/ppa_canonical-server_server-backports.list:
	sudo -- ./libexec/add-ppa.sh canonical-server/server-backports

qemu.pull: $(CACHE)/qemu/vmlinuz
$(CACHE)/qemu/vmlinuz:
	sudo -- $(CURL) --output '$@.part' -- '$(KERNEL)'
	sudo -- mv -v -f -- '$@.part' '$@'

qemu.pull: $(CACHE)/qemu/initrd
$(CACHE)/qemu/initrd:
	sudo -- $(CURL) --output '$@.part' -- '$(INITRD)'
	sudo -- mv -v -f -- '$@.part' '$@'

$(CACHE)/qemu/cloudimg.qcow2:
	sudo -- $(CURL) --output '$@.part' -- '$(KVMBUNTU)'
	sudo -- mv -v -f -- '$@.part' '$@'

qemu.pull: $(QEMU_IMG)
$(QEMU_IMG): $(CACHE)/qemu/cloudimg.qcow2
	sudo -- /usr/local/opt/qemu/libexec/cloudimg-etl.sh '$<' '$@'


VIRTIO_WIN_IMG := https://fedorapeople.org/groups/virt/virtio-win/direct-downloads/stable-virtio/virtio-win.iso
qemu.pull: $(CACHE)/qemu/$(notdir $(VIRTIO_WIN_IMG))
$(CACHE)/qemu/$(notdir $(VIRTIO_WIN_IMG)):
	sudo -- $(CURL) --output '$@.part' -- '$(VIRTIO_WIN_IMG)'
	sudo -- mv -v -f -- '$@.part' '$@'
