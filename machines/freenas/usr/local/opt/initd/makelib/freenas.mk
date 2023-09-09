pkg._: /etc/apt/sources.list.d/ppa_qbittorrent-team_qbittorrent-stable.list
/etc/apt/sources.list.d/ppa_qbittorrent-team_qbittorrent-stable.list:
	sudo -- ./libexec/add-ppa.sh qbittorrent-team/qbittorrent-stable


V_RCLONE := $(shell ./libexec/gh-latest.sh $(TMP) rclone/rclone)
RCLONE := https://github.com/rclone/rclone/releases/latest/download/rclone-$(V_RCLONE)-linux-$(GOARCH).deb

$(TMP)/rclone.deb: | /usr/bin/curl /usr/bin/jq
	$(CURL) --output '$@' -- '$(RCLONE)'

all: /usr/local/opt/rclone/usr/bin/rclone
/usr/local/opt/rclone/usr/bin/rclone: | $(TMP)/rclone.deb
	dpkg --instdir /usr/local/opt/rclone  --install '$(TMP)/rclone.deb'

