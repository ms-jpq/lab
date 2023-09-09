.PHONY: clobber.fs clobber.cache

CLOBBER.FS :=

clobber: clobber.fs
clobber.fs:
	shopt -u failglob
	rm -v -rf -- $(CLOBBER.FS)

CLOBBER.FS += /usr/local/*
CLOBBER.FS += /etc/apt/sources.list.d/*


clobber.cache:
	shopt -u failglob
	rm -v -rf -- $(CACHE)/*
