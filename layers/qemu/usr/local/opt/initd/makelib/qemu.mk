.PHONY: qemu.grub qemu.pull clobber.qemu

pull: qemu.pull

qemu.grub:
	update-initramfs -u && update-gru

clobber.qemu:
	shopt -u failglob
	sudo -- rm -v -rf -- /var/cache/local/qemu/*

KVMBUNTU := https://cloud-images.ubuntu.com/releases/$(VERSION_ID)/release/ubuntu-$(VERSION_ID)-server-cloudimg-$(GOARCH).img
VIRTIO_WIN_IMG := https://fedorapeople.org/groups/virt/virtio-win/direct-downloads/stable-virtio/virtio-win.iso

qemu.pull: /var/cache/local/qemu/cloudimg.raw
/var/cache/local/qemu/cloudimg.qcow2:
	sudo -- curl --fail --location --create-dirs --output '$@.part' -- '$(KVMBUNTU)'
	sudo -- mv -v -f -- '$@.part' '$@'

/var/cache/local/qemu/cloudimg.raw: /var/cache/local/qemu/cloudimg.qcow2
	sudo -- qemu-img convert -f qcow2 -O raw '$<' '$@'

qemu.pull: /var/cache/local/qemu/$(notdir $(VIRTIO_WIN_IMG))
/var/cache/local/qemu/$(notdir $(VIRTIO_WIN_IMG)):
	sudo -- curl --fail --location --create-dirs --output '$@.part' -- '$(VIRTIO_WIN_IMG)'
	sudo -- mv -v -f -- '$@.part' '$@'
