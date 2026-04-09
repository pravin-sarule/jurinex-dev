"""
Audio MIME types accepted for case uploads (aligned with Speech-to-Text adapter).

Used for documentation and optional policy checks; the OCR/STT layer in
``speech_to_text`` defines the authoritative encoding map.
"""

SUPPORTED_AUDIO_MIME_TYPES: frozenset[str] = frozenset(
    {
        "audio/mpeg",
        "audio/mp3",
        "audio/wav",
        "audio/x-wav",
        "audio/wave",
        "audio/flac",
        "audio/x-flac",
        "audio/mp4",
        "audio/x-m4a",
        "audio/m4a",
        "audio/webm",
        "audio/ogg",
        "audio/ogg; codecs=opus",
        "audio/webm; codecs=opus",
        "video/mp4",
        "audio/aac",
        "audio/amr",
        "audio/amr-wb",
    }
)
