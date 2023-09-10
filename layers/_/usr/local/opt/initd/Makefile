MAKEFLAGS += --check-symlink-times
MAKEFLAGS += --jobs
MAKEFLAGS += --no-builtin-rules
MAKEFLAGS += --no-builtin-variables
MAKEFLAGS += --shuffle
MAKEFLAGS += --warn-undefined-variables
SHELL := bash
.ONESHELL:
.SHELLFLAGS := --norc --noprofile -Eeuo pipefail -O dotglob -O nullglob -O extglob -O failglob -O globstar -c

.DEFAULT_GOAL := all

.PHONY: clean clobber all pull

clean:
	shopt -u failglob
	rm -v -rf -- $(TMP)

clobber: clean
	shopt -u failglob
	rm -v -rf --


CACHE := /var/cache/local
TMP := /var/tmp/local/initd

APT_INSTALL := DEBIAN_FRONTEND=noninteractive sudo --preserve-env -- apt-get install --yes

include lib/*.mk
include makelib/*.mk

all: pkg venv
