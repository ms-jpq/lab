from collections.abc import Iterator
from re import VERBOSE, compile

from .ffmpeg import Stream

_CODECS = {
    "ar": ("ara",),
    "cs": ("ces",),
    "de": ("deu", "ger"),
    "el": ("ell",),
    "en": ("eng",),
    "es": ("spa",),
    "fi": ("fin",),
    "fr": ("fra", "fre"),
    "he": ("heb",),
    "hi": ("hin",),
    "id": ("ind",),
    "it": ("ita",),
    "ja": ("jpn",),
    "ko": ("kor",),
    "nl": ("dut", "nld"),
    "no": ("nor",),
    "pl": ("pol",),
    "pt": ("por",),
    "ru": ("rus",),
    "sv": ("swe",),
    "th": ("tha",),
    "tr": ("tur",),
    "uk": ("ukr",),
    "vi": ("vie",),
    "zh": ("chi", "zho"),
}
_RANGE = compile(
    r"""\s*(?P<language>[A-Za-z]{2,8})(?:-[A-Za-z0-9]{1,8})*
        (?:\s*;\s*q=(?P<quality>0(?:\.\d{0,3})?|1(?:\.0{0,3})?))?\s*""",
    VERBOSE,
)


def _codecs(value: str) -> Iterator[str]:
    for item in value.split(","):
        if (match := _RANGE.fullmatch(item)) and (
            quality := float(match.group("quality") or 1)
        ):
            language = match.group("language").casefold()
            yield from _CODECS.get(language, (language,))
    return


def select_subtitle(
    *,
    audio: Stream | None,
    subtitles: tuple[Stream, ...],
    accept_language: str | None,
) -> Stream | None:
    active = {*_codecs(accept_language or "")}
    if audio and audio.language in active:
        return None

    for item in subtitles:
        if item.language in active:
            return item

    return None
