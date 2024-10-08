#!/usr/bin/env -S -- PYTHONSAFEPATH= python3

from configparser import RawConfigParser
from itertools import chain
from json import loads
from os import linesep
from pathlib import Path
from uuid import uuid4

from miniflux import Client


class _Parser(RawConfigParser):
    def optionxform(self, optionstr: str) -> str:
        return optionstr


facts = Path(__file__).parent.parent / "facts"
text = facts.joinpath("droplet.env").read_text()
lines = "".join(chain((f"[{uuid4()}]", linesep), text))
parser = _Parser(
    allow_no_value=True,
    strict=False,
    interpolation=None,
    comment_prefixes=("#",),
    delimiters=("=",),
)
parser.read_string(lines)
env = {k: v for section in parser.values() for k, v in section.items()}

domain, category, username, password = (
    env["ENV_DOMAIN"],
    env["ENV_LIBREDDIT_CATEGORY"],
    env["ENV_MAIL"],
    env["ENV_MINIFLUX_PASSWORD"],
)

client = Client(f"https://rss.{domain}", username=username, password=password)
feeds = client.get_feeds()
uris = {feed["feed_url"]: feed["id"] for feed in feeds}

json = loads(facts.joinpath("droplet.json").read_text())
subs = {
    f"https://reddit.{domain}/r/{sub}.rss"
    for sub in json["ENV_REDLIB_DEFAULT_SUBSCRIPTIONS"]
}
categories = {cat["title"]: cat["id"] for cat in client.get_categories()}
category_id = categories[category]

for feed_url in subs:
    if feed_id := uris.get(feed_url):
        client.delete_feed(feed_id)

    client.create_feed(
        feed_url,
        category_id=category_id,
        allow_self_signed_certificates=True,
        crawler=True,
    )
