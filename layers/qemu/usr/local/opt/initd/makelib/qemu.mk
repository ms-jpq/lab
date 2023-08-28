.PHONY: qemu.pull clobber.qemu

clobber.qemu:
	shopt -u failglob
	sudo -- rm -v -rf -- /var/cache/local/qemu/*

KVMBUNTU := https://cloud-images.ubuntu.com/releases/$(VERSION_ID)/release/ubuntu-$(VERSION_ID)-server-cloudimg-$(GOARCH)-disk-kvm.img
qemu.pull: /var/cache/local/qemu/cloudimg.qcow2
/var/cache/local/qemu/cloudimg.qcow2:
	sudo -- mkdir -v -p -- '$(@D)'
	sudo -- curl --fail --location --output '$@' -- '$(KVMBUNTU)'
