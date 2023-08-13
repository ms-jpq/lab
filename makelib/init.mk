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
export -- PYDEPS

CURL := curl --fail --location --no-progress-meter

$(VAR)/bin:
	mkdir -v -p -- '$@'

./.bundle/config:
	bundle config set --local path '$(PWD)/vendor'

./vendor: | ./.bundle/config
	bundle install

./.venv/bin:
	python3 -m venv -- './.venv'
	'$@/python3' <<< "$$PYDEPS"

./node_modules/.bin:
	npm install --upgrade --no-package-lock

$(VAR)/bin/shellcheck: | $(VAR)/bin
	VERSION='v0.9.0'
	case "$$OSTYPE" in
	darwin*)
		FILE='darwin.x86_64'
		;;
	linux*)
		FILE='linux.x86_64'
		;;
	esac
	URI="https://github.com/koalaman/shellcheck/releases/latest/download/shellcheck-$$VERSION.$$FILE.tar.xz"
	$(CURL) -- "$$URI" | tar --extract --xz --file - --directory '$(VAR)/bin' --strip-components 1 --wildcards 'shellcheck-*/shellcheck'
	chmod -v +x -- '$@'

$(VAR)/bin/hadolint: | $(VAR)/bin
	case "$$OSTYPE" in
	darwin*)
		FILE='hadolint-Darwin-x86_64'
		;;
	linux*)
		FILE='hadolint-Linux-x86_64'
		;;
	esac
	URI="https://github.com/hadolint/hadolint/releases/latest/download/$$FILE"
	$(CURL) --output '$@' -- "$$URI"
	chmod +x -- '$@'


$(VAR)/bin/shfmt: | $(VAR)/bin
	VERSION='v3.7.0'
	case "$$OSTYPE" in
	darwin*)
		FILE='darwin_arm64'
		;;
	linux*)
		FILE='linux_amd64'
		;;
	esac
	URI="https://github.com/mvdan/sh/releases/latest/download/shfmt_$${VERSION}_$$FILE"
	$(CURL) --output '$@' -- "$$URI"
	chmod +x -- '$@'


$(VAR)/sh: | $(VAR)
	if [[ -d '$@' ]]; then
		cd -- '$@'
		git pull --recurse-submodules --no-tags '--jobs=$(NPROC)'
	else
		git clone --recurse-submodules --shallow-submodules --depth=1 '--jobs=$(NPROC)' -- 'https://github.com/ms-jpq/shell_rc' '$@'
	fi
