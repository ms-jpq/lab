.PHONY: pkg

pkg: ./libexec/pkg.sh
	'$<'

APT_INSTALL := DEBIAN_FRONTEND=noninteractive sudo --preserve-env -- apt-get install --no-install-recommends --yes
APT_DEPS := /etc/ssl/certs/ca-certificates.crt /usr/bin/curl /usr/bin/gpg /usr/bin/jq /usr/bin/git /usr/share/doc/python3-venv

/usr/bin/unzip:
	APT=(ca-certificates curl gnupg jq git unzip python3-venv)
	sudo -- apt-get update
	$(APT_INSTALL) -- "$${APT[@]}"

$(APT_DEPS): | /usr/bin/unzip


define SYSTEMD_MASK_TEMPLATE
pkg: /usr/local/lib/systemd/$1
/usr/local/lib/systemd/$1:
	mkdir -v -p -- '$$(@D)'
	ln -v -sf -- /dev/null '$@'
endef


$(foreach mask,$(shell cat -- ./masks/*.txt),$(eval $(call SYSTEMD_MASK_TEMPLATE,$(mask))))
