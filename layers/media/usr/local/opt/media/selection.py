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
    preferences = (
        (float(match.group("quality") or 1), match.group("language").casefold())
        for item in value.split(",")
        if (match := _RANGE.fullmatch(item))
    )
    for quality, language in sorted(preferences, key=lambda item: -item[0]):
        if quality:
            yield language
            yield from _CODECS.get(language, ())
    return


def select_stream(
    *,
    audio: Stream | None,
    streams: tuple[Stream, ...],
    accept_language: str | None,
) -> Stream | None:
    active = tuple(_codecs(accept_language or ""))
    if audio and audio.language.casefold() in active:
        return None

    for language in active:
        for item in streams:
            if item.language.casefold() == language:
                return item

    return next((item for item in streams if item.default), None)
