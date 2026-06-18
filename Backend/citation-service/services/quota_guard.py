"""Re-export payment-service token check + usage logging (backward compatible)."""
from services.payment_guard import check_token_availability, log_llm_usage

check_token_limits = check_token_availability
check_daily_token_limit = check_token_availability
