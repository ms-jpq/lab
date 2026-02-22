.PHONY: elasticsearch clobber.elasticsearch

all: elasticsearch

pkg._: /etc/apt/trusted.gpg.d/elastic-search.gpg
/etc/apt/trusted.gpg.d/elastic-search.gpg:
	$(CURL) -- 'https://artifacts.elastic.co/GPG-KEY-elasticsearch' | sudo -- gpg --batch --dearmor --yes --output '$@'

/etc/elasticsearch/jvm.options: | pkg._
elasticsearch: /usr/local/opt/elasticsearch/jvm.options
/usr/local/opt/elasticsearch/jvm.options: /etc/elasticsearch/jvm.options
	sudo -- sed -E -e 's#/var/log/#/var/tmp/#' -- '$<' | sudo -- tee -- '$@' >/dev/null
