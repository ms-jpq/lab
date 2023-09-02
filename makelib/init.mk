define PYDEPS
from itertools import chain
from os import execl
from sys import executable
from tomllib import load

with open("pyproject.toml", "rb") as fd:
  toml = load(fd)

project = toml["project"]
execl(
  executable,
  executable,
  "-m",
  "pip",
  "install",
  "--upgrade",
  "--",
  *project.get("dependencies", ()),
  *chain.from_iterable(project["optional-dependencies"].values()),
)
endef

CURL := curl --fail --location --no-progress-meter

$(VAR)/bin: | $(VAR)
	mkdir -v -p -- '$@'

./.venv/bin:
	python3 -m venv -- './.venv'
	'$@/python3' <<< '$(PYDEPS)'

./node_modules/.bin:
	npm install --upgrade --no-package-lock


V_SHELLCHECK := $(shell ./libexec/gh-latest.sh $(VAR) koalaman/shellcheck)
V_SHFMT := $(shell ./libexec/gh-latest.sh $(VAR) mvdan/sh)
HADO_OS := $(shell perl -CASD -wpe 's/([a-z])/\u$$1/' <<<'$(OS)')

$(VAR)/bin/shellcheck: | $(VAR)/bin
	URI='https://github.com/koalaman/shellcheck/releases/latest/download/shellcheck-$(V_SHELLCHECK).$(OS).x86_64.tar.xz'
	$(CURL) -- "$$URI" | tar --extract --xz --file - --directory '$(VAR)/bin' --strip-components 1 "shellcheck-$(V_SHELLCHECK)/shellcheck"
	chmod +x '$@'

$(VAR)/bin/hadolint: | $(VAR)/bin
	URI='https://github.com/hadolint/hadolint/releases/latest/download/hadolint-$(HADO_OS)-x86_64'
	$(CURL) --output '$@' -- "$$URI"
	chmod +x '$@'

$(VAR)/bin/shfmt: | $(VAR)/bin
	URI='https://github.com/mvdan/sh/releases/latest/download/shfmt_$(V_SHFMT)_$(OS)_$(GOARCH)'
	$(CURL) --output '$@' -- "$$URI"
	chmod +x '$@'
