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
	rm -v -rf -- ./tmp

clobber: clean
	shopt -u failglob
	rm -v -rf -- '$(VAR)' ./.venv/ ./node_modules/ ./.bundle/ ./vendor/ Gemfile.lock package-lock.json

./tmp:
	mkdir -v -p -- '$@'

VAR := ./var
TMP := '$(VAR)/tmp'

include env.mk
include makelib/*.mk
