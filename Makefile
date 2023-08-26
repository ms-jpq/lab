MAKEFLAGS += --jobs
MAKEFLAGS += --no-builtin-rules
MAKEFLAGS += --warn-undefined-variables
SHELL := bash
.DELETE_ON_ERROR:
.ONESHELL:
.SHELLFLAGS := --norc --noprofile -Eeuo pipefail -O dotglob -O nullglob -O extglob -O failglob -O globstar -c

.DEFAULT_GOAL := local

.PHONY: clean clobber

clean:
	shopt -u failglob
	rm -v -rf -- '$(TMP)'

clobber: clean
	shopt -u failglob
	rm -v -rf -- '$(VAR)' ./.venv/ ./node_modules/ package-lock.json


VAR := ./var
TMP := $(VAR)/tmp

$(VAR):
	mkdir -v -p -- '$@'

$(TMP): | $(VAR)
	mkdir -v -p -- '$@'


include layers/_/usr/local/opt/initd/lib/*.mk
include makelib/*.mk
