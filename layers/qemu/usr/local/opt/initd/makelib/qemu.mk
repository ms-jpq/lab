.PHONY: qemu.grub qemu.pull clobber.qemu

pull: qemu.pull

qemu.grub:
	update-initramfs -u && update-grub

clobber.qemu:
	shopt -u failglob
	sudo -- rm -v -rf -- /var/cache/local/qemu/*

CURL_CO := sudo -- curl --fail --location --create-dirs --output

CLOUD_IMG_AT := https://cloud-images.ubuntu.com/releases/$(VERSION_ID)/release
KERNEL := $(CLOUD_IMG_AT)/unpacked/ubuntu-$(VERSION_ID)-server-cloudimg-$(GOARCH)-vmlinuz-generic
INITRD := $(CLOUD_IMG_AT)/unpacked/ubuntu-$(VERSION_ID)-server-cloudimg-$(GOARCH)-initrd-generic
KVMBUNTU := $(CLOUD_IMG_AT)/ubuntu-$(VERSION_ID)-server-cloudimg-$(GOARCH).img

qemu.pull: /var/cache/local/qemu/vmlinuz
/var/cache/local/qemu/vmlinuz:
	$(CURL_CO) '$@.part' -- '$(KERNEL)'
	sudo -- mv -v -f -- '$@.part' '$@'

qemu.pull: /var/cache/local/qemu/initrd
/var/cache/local/qemu/initrd:
	$(CURL_CO) '$@.part' -- '$(INITRD)'
	sudo -- mv -v -f -- '$@.part' '$@'

/var/cache/local/qemu/cloudimg.qcow2:
	$(CURL_CO) '$@.part' -- '$(KVMBUNTU)'
	sudo -- mv -v -f -- '$@.part' '$@'

qemu.pull: /var/cache/local/qemu/cloudimg.raw
/var/cache/local/qemu/cloudimg.raw: /var/cache/local/qemu/cloudimg.qcow2
	sudo -- qemu-img convert -f qcow2 -O raw '$<' '$@'


VIRTIO_WIN_IMG := https://fedorapeople.org/groups/virt/virtio-win/direct-downloads/stable-virtio/virtio-win.iso
qemu.pull: /var/cache/local/qemu/$(notdir $(VIRTIO_WIN_IMG))
/var/cache/local/qemu/$(notdir $(VIRTIO_WIN_IMG)):
	$(CURL_CO) '$@.part' -- '$(VIRTIO_WIN_IMG)'
	sudo -- mv -v -f -- '$@.part' '$@'
