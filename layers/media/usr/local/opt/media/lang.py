from re import VERBOSE, compile

from .ffmpeg import Stream

_CODES = {
    "ara": "ar",
    "ces": "cs",
    "chi": "zh",
    "deu": "de",
    "dut": "nl",
    "ell": "el",
    "eng": "en",
    "fin": "fi",
    "fra": "fr",
    "fre": "fr",
    "ger": "de",
    "heb": "he",
    "hin": "hi",
    "ind": "id",
    "ita": "it",
    "jpn": "ja",
    "kor": "ko",
    "nld": "nl",
    "nor": "no",
    "pol": "pl",
    "por": "pt",
    "rus": "ru",
    "spa": "es",
    "swe": "sv",
    "tha": "th",
    "tur": "tr",
    "ukr": "uk",
    "vie": "vi",
    "zho": "zh",
}
_RANGE = compile(
    r"""\s*(?P<language>[A-Za-z]{2,8})(?:-[A-Za-z0-9]{1,8})*
        (?:\s*;\s*q=(?P<quality>0(?:\.\d{0,3})?|1(?:\.0{0,3})?))?\s*""",
    VERBOSE,
)


def _language(value: str) -> str:
    candidates: list[tuple[float, int, str]] = []
    for index, item in enumerate(value.split(",")):
        if not (match := _RANGE.fullmatch(item)):
            continue

        if quality := float(match.group("quality") or 1):
            language = match.group("language").casefold()
            candidates.append((quality, -index, _CODES.get(language, language)))

    _, _, language = max(candidates, default=(0, 0, ""))
    return language


def select_subtitle(
    *,
    accept_language: str | None,
    default_audio: Stream | None,
    subtitles: tuple[Stream, ...],
) -> str:
    if (
        not (language := _language(accept_language or ""))
        or default_audio is None
        or language == _language(default_audio.language)
    ):
        return ""

    for item in subtitles:
        if _language(item.language) == language:
            return item.index

    for item in subtitles:
        if item.default:
            return item.index

    for item in subtitles:
        return item.index

    return ""
