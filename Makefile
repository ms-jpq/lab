MAKEFLAGS += --jobs
MAKEFLAGS += --no-builtin-rules
MAKEFLAGS += --warn-undefined-variables
SHELL := bash
.DELETE_ON_ERROR:
.ONESHELL:
.SHELLFLAGS := --norc --noprofile -Eeuo pipefail -O dotglob -O nullglob -O extglob -O failglob -O globstar -c

.DEFAULT_GOAL := help

.PHONY: clean clobber

clean:
	shopt -u failglob
	rm -v -rf -- '$(TMP)'

clobber: clean
	shopt -u failglob
	rm -v -rf -- '$(VAR)' ./.venv/ ./node_modules/ ./.bundle/ ./vendor/ Gemfile.lock package-lock.json


VAR := ./var
TMP := $(VAR)/tmp

$(TMP):
	mkdir -v -p -- '$@'

include env.mk
include makelib/*.mk
