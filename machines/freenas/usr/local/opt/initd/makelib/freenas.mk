pkg._: /etc/apt/sources.list.d/ppa_qbittorrent-team_qbittorrent-stable.list
/etc/apt/sources.list.d/ppa_qbittorrent-team_qbittorrent-stable.list:
	sudo -- ./libexec/add-ppa.sh qbittorrent-team/qbittorrent-stable


V_RCLONE := $(shell /usr/local/libexec/gh-latest.sh /tmp rclone/rclone)
N_RCLONE := rclone-$(V_RCLONE)-linux-$(GOARCH)
RCLONE := https://github.com/rclone/rclone/releases/latest/download/$(N_RCLONE).zip

$(TMP)/rclone.zip: | /usr/bin/curl /usr/bin/jq
	sudo -- $(CURL) --output '$@' -- '$(RCLONE)'

all: /usr/local/libexec/rclone
/usr/local/libexec/rclone: $(TMP)/rclone.zip
	sudo -- unzip -o -d '$(TMP)' -- '$<'
	sudo -- install -b -- '$(TMP)/$(N_RCLONE)/rclone' '$@'
