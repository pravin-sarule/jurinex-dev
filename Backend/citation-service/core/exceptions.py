class CitationPipelineError(RuntimeError):
    """Base V2 pipeline error."""


class BudgetExceeded(CitationPipelineError):
    """Raised before a paid operation would exceed a configured budget."""
