MAKEFLAGS += --check-symlink-times
MAKEFLAGS += --jobs
MAKEFLAGS += --no-builtin-rules
MAKEFLAGS += --no-builtin-variables
MAKEFLAGS += --shuffle
MAKEFLAGS += --warn-undefined-variables
SHELL := bash
.DELETE_ON_ERROR:
.ONESHELL:
.SHELLFLAGS := --norc --noprofile -Eeuo pipefail -O dotglob -O nullglob -O extglob -O failglob -O globstar -c

.DEFAULT_GOAL := local

# TODO: gnumake 4.4 .WAIT
.PHONY: clean clobber .WAIT

clean:
	shopt -u failglob
	rm -v -rf -- '$(TMP)' package-lock.json

clobber: clean
	shopt -u failglob
	rm -v -rf -- '$(VAR)' ./.venv/ ./node_modules/ ./terraform/*/.terraform ./*.gpg ./facts/*.gpg


VAR := ./var
TMP := $(VAR)/tmp

$(VAR):
	mkdir -v -p -- '$@'

$(TMP): | $(VAR)
	mkdir -v -p -- '$@'


ifeq ($(origin MACHINE), command line)
include makelib/facts.mk
include makelib/local.mk
else
include layers/_/usr/local/opt/initd/lib/*.mk
include makelib/*.mk
endif
