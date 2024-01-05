.PHONY: qemu qemu.grub qemu.pull clobber.qemu

pull: qemu.pull

all: /usr/local/lib/systemd/system/2-qemu-q35@.service

/usr/local/lib/systemd/system/2-qemu-q35@.service: /usr/local/lib/systemd/system/2-qemu-microvm@.service
	sudo -- cp -v -f -- '$<' '$@'

qemu: 2-qemu-q35@.service

qemu.grub:
	update-initramfs -u && update-grub

clobber.qemu:
	shopt -u failglob
	sudo -- rm -v -rf -- $(CACHE)/qemu/*

pkg._: /etc/apt/sources.list.d/ppa_canonical-server_server-backports.list
/etc/apt/sources.list.d/ppa_canonical-server_server-backports.list:
	sudo -- ./libexec/add-ppa.sh canonical-server/server-backports


CURL_CO := sudo -- curl --fail --location --create-dirs --output

CLOUD_IMG_AT := https://cloud-images.ubuntu.com/releases/$(VERSION_ID)/release
KERNEL := $(CLOUD_IMG_AT)/unpacked/ubuntu-$(VERSION_ID)-server-cloudimg-$(GOARCH)-vmlinuz-generic
INITRD := $(CLOUD_IMG_AT)/unpacked/ubuntu-$(VERSION_ID)-server-cloudimg-$(GOARCH)-initrd-generic
KVMBUNTU := $(CLOUD_IMG_AT)/ubuntu-$(VERSION_ID)-server-cloudimg-$(GOARCH).img

qemu.pull: $(CACHE)/qemu/vmlinuz
$(CACHE)/qemu/vmlinuz:
	$(CURL_CO) '$@.part' -- '$(KERNEL)'
	sudo -- mv -v -f -- '$@.part' '$@'

qemu.pull: $(CACHE)/qemu/initrd
$(CACHE)/qemu/initrd:
	$(CURL_CO) '$@.part' -- '$(INITRD)'
	sudo -- mv -v -f -- '$@.part' '$@'

$(CACHE)/qemu/cloudimg.qcow2:
	$(CURL_CO) '$@.part' -- '$(KVMBUNTU)'
	sudo -- mv -v -f -- '$@.part' '$@'

qemu.pull: $(CACHE)/qemu/cloudimg.raw
$(CACHE)/qemu/cloudimg.raw: $(CACHE)/qemu/cloudimg.qcow2
	sudo -- qemu-img convert -f qcow2 -O raw '$<' '$@'


VIRTIO_WIN_IMG := https://fedorapeople.org/groups/virt/virtio-win/direct-downloads/stable-virtio/virtio-win.iso
qemu.pull: $(CACHE)/qemu/$(notdir $(VIRTIO_WIN_IMG))
$(CACHE)/qemu/$(notdir $(VIRTIO_WIN_IMG)):
	$(CURL_CO) '$@.part' -- '$(VIRTIO_WIN_IMG)'
	sudo -- mv -v -f -- '$@.part' '$@'
