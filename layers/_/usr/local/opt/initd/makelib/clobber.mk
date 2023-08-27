.PHONY: clobber.fs

CLOBBER.FS :=

clobber: clobber.fs
clobber.fs:
	shopt -u failglob
	printf '%q ' -- rm -v -rf -- $(CLOBBER.FS)

CLOBBER.FS += /usr/local/* /var/cache/local/*
CLOBBER.FS += /etc/apt/sources.list.d/*
