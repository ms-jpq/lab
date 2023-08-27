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

.PHONY: clean clobber

clean:
	shopt -u failglob
	rm -v -rf --

clobber: clean
	shopt -u failglob
	rm -v -rf --

CURL := curl --fail --location --no-progress-meter

include lib/*.mk
include makelib/*.mk

all: pkg venv
