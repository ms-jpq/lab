define PYDEPS
from itertools import chain
from os import execl
from sys import executable
from tomllib import load

toml = load(open("pyproject.toml", "rb"))

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

$(VAR)/bin: | $(VAR)
	mkdir -v -p -- '$@'

./.venv/bin:
	python3 -m venv -- './.venv'
	'$@/python3' <<< '$(PYDEPS)'

./node_modules/.bin:
	npm install --upgrade --no-package-lock


ifeq ($(HOSTTYPE), aarch64)
S5_TYPE := $(GOARCH)
else
S5_TYPE := 64bit
endif

V_HELM       = $(shell ./libexec/gh-latest.sh $(VAR) helm/helm)
V_KUSTOMIZE  = $(subst /,_,$(shell ./libexec/gh-latest.sh $(VAR) kubernetes-sigs/kustomize))
V_SHELLCHECK = $(shell ./libexec/gh-latest.sh $(VAR) koalaman/shellcheck)
V_SHFMT      = $(shell ./libexec/gh-latest.sh $(VAR) mvdan/sh)
V_TFLINT     = $(shell ./libexec/gh-latest.sh $(VAR) terraform-linters/tflint)
V_TOFU       = $(patsubst v%,%,$(shell ./libexec/gh-latest.sh $(VAR) hashicorp/terraform))

S5_OS = $(shell perl -CASD -wpe 's/([a-z])/\u$$1/;s/Darwin/macOS/' <<<'$(OS)')
HADO_OS = $(shell perl -CASD -wpe 's/([a-z])/\u$$1/' <<<'$(OS)')


$(VAR)/bin/shellcheck: | $(VAR)/bin
	URI='https://github.com/koalaman/shellcheck/releases/latest/download/shellcheck-$(V_SHELLCHECK).$(OS).x86_64.tar.xz'
	$(CURL) -- "$$URI" | tar --extract --xz --file - --directory '$(VAR)/bin' --strip-components 1 -- 'shellcheck-$(V_SHELLCHECK)/shellcheck'
	chmod +x '$@'

$(VAR)/bin/hadolint: | $(VAR)/bin
	URI='https://github.com/hadolint/hadolint/releases/latest/download/hadolint-$(HADO_OS)-x86_64'
	$(CURL) --output '$@' -- "$$URI"
	chmod +x '$@'

$(VAR)/bin/shfmt: | $(VAR)/bin
	URI='https://github.com/mvdan/sh/releases/latest/download/shfmt_$(V_SHFMT)_$(OS)_$(GOARCH)'
	$(CURL) --output '$@' -- "$$URI"
	chmod +x '$@'

$(VAR)/bin/tflint: | $(VAR)/bin
	URI='https://github.com/terraform-linters/tflint/releases/latest/download/tflint_$(OS)_$(GOARCH).zip'
	ZIP='$(TMP)/tflint.zip'
	$(CURL) --output "$$ZIP" -- "$$URI"
	unzip -o -d '$(VAR)/bin' -- "$$ZIP"

$(VAR)/bin/terraform: | $(VAR)/bin
	URI='https://releases.hashicorp.com/terraform/$(V_TOFU)/terraform_$(V_TOFU)_$(OS)_$(GOARCH).zip'
	ZIP='$(TMP)/tofu.zip'
	$(CURL) --output "$$ZIP" -- "$$URI"
	unzip -o -d '$(VAR)/bin' -- "$$ZIP"
	chmod +x '$@'

$(VAR)/tflint.d: $(VAR)/bin/tflint terraform/bootstrap/.tflint.hcl
	printf -- '%s\0' ./terraform/* | xargs -r -0 -n 1 -- '$<' --init --chdir

$(VAR)/bin/kompose: | $(VAR)/bin
	URI='https://github.com/kubernetes/kompose/releases/latest/download/kompose-$(OS)-$(GOARCH).tar.gz'
	$(CURL) -- "$$URI" | tar --extract --gz --file - --directory '$(VAR)/bin'
	mv -v -f -- '$(VAR)/bin/kompose-$(OS)-$(GOARCH)' '$@'

$(VAR)/bin/helm: | $(VAR)/bin
	URI='https://get.helm.sh/helm-$(V_HELM)-$(OS)-$(GOARCH).tar.gz'
	$(CURL) -- "$$URI" | tar --extract --gz --file - --directory '$(VAR)/bin' --strip-components 1

$(VAR)/bin/kustomize: | $(VAR)/bin
	URI='https://github.com/kubernetes-sigs/kustomize/releases/latest/download/$(V_KUSTOMIZE)_$(OS)_$(GOARCH).tar.gz'
	$(CURL) -- "$$URI" | tar --extract --gz --file - --directory '$(VAR)/bin'
