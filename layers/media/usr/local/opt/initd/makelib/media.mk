.PHONY: media

all: media

media: /etc/apt/trusted.gpg.d/plex.gpg
media: /etc/apt/trusted.gpg.d/jellyfin.gpg

/etc/apt/trusted.gpg.d/plex.gpg:
	$(CURL) -- 'https://downloads.plex.tv/plex-keys/PlexSign.key' | sudo -- gpg --batch --dearmor --yes --output '$@'

/etc/apt/trusted.gpg.d/jellyfin.gpg:
	$(CURL) -- 'https://repo.jellyfin.org/jellyfin_team.gpg.key' | sudo -- gpg --batch --dearmor --yes --output '$@'
