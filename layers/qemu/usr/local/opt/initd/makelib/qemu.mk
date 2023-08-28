.PHONY: qemu.pull clobber.qemu

pull: qemu.pull

clobber.qemu:
	shopt -u failglob
	sudo -- rm -v -rf -- /var/cache/local/qemu/*

KVMBUNTU := https://cloud-images.ubuntu.com/releases/$(VERSION_ID)/release/ubuntu-$(VERSION_ID)-server-cloudimg-$(GOARCH)-disk-kvm.img
VIRTIO_WIN_IMG := https://fedorapeople.org/groups/virt/virtio-win/direct-downloads/stable-virtio/virtio-win.iso

qemu.pull: /var/cache/local/qemu/cloudimg.qcow2
/var/cache/local/qemu/cloudimg.qcow2:
	sudo -- curl --fail --location --create-dirs --output '$@' -- '$(KVMBUNTU)'

qemu.pull: /var/cache/local/qemu/$(notdir $(VIRTIO_WIN_IMG))
/var/cache/local/qemu/$(notdir $(VIRTIO_WIN_IMG)):
	sudo -- curl --fail --location --create-dirs --output '$@' -- '$(VIRTIO_WIN_IMG)'
