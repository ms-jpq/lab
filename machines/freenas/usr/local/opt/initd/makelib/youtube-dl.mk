.PHONY: youtube-dl
all: youtube-dl

youtube-dl: $(CACHE)/youtube-dl/bin

$(CACHE)/youtube-dl/bin:
	sudo -- $(CURL) --output '$@' -- 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux'
	sudo -- chmod +x '$@'
