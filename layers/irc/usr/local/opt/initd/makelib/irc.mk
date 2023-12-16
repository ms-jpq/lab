.PHONY: irc

all: irc

irc: /etc/apt/trusted.gpg.d/weechat.gpg /var/cache/local/weechat/venv

/etc/apt/trusted.gpg.d/weechat.gpg:
	$(CURL) -- 'https://weechat.org/dev/info/debian_repository_signing_key' | sudo -- gpg --batch --dearmor --yes --output '$@'

$(CACHE)/weechat/venv:
	sudo -- python3 -m venv -- '$@'

define IRC_GIT_TEMPLATE
irc: $(CACHE)/weechat/$(notdir $1)
$(CACHE)/weechat/$(notdir $1):
	if [[ -d '$$@' ]]; then
		cd -- '$$@'
		sudo -- git pull --no-tags '--jobs=$$(NPROC)'
	else
		sudo -- git clone --depth=1 '--jobs=$$(NPROC)' -- 'https://github.com/$1' '$$@'
	fi
endef

IRC_REPOS := weechat/scripts poljar/weechat-matrix wee-slack/wee-slack
$(foreach repo,$(IRC_REPOS),$(eval $(call IRC_GIT_TEMPLATE,$(repo))))

