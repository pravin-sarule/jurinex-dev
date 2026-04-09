"""Audio ingestion errors for the legal document pipeline."""


class AudioProcessingError(RuntimeError):
    """Raised when Speech-to-Text fails or returns no usable transcript."""
