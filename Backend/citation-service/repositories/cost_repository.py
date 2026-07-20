from typing import TypedDict


class IKCall(TypedDict):
    hits: int
    cost_inr: float


class AIUsage(TypedDict):
    service: str
    model: str
    input_tokens: int
    output_tokens: int
    cost_inr: float
    calls: int


def summarize_cost(run_id: str) -> dict:
    from db.client import usage_get_by_run
    rows = usage_get_by_run(run_id)

    total_inr = 0.0
    total_usd = 0.0

    ik_calls: dict[str, IKCall] = {}
    ik_total_inr = 0.0

    ai_usage: dict[str, AIUsage] = {}
    ai_total_inr = 0.0

    for row in rows:
        cost_inr = float(row.get("cost_inr") or 0)
        cost_usd = float(row.get("cost_usd") or 0)
        total_inr += cost_inr
        total_usd += cost_usd
        
        service = row.get("service")
        operation = str(row.get("operation") or "unknown")  # dict key must be str
        meta = row.get("metadata") or {}
        
        if service == "indian_kanoon":
            ik_total_inr += cost_inr
            if operation not in ik_calls:
                ik_calls[operation] = {"hits": 0, "cost_inr": 0.0}
            ik_calls[operation]["hits"] += int(row.get("quantity") or 1)
            ik_calls[operation]["cost_inr"] += cost_inr
            
        elif service in ("gemini", "claude"):
            ai_total_inr += cost_inr
            model = meta.get("model") or "unknown"
            key = f"{service}:{model}"
            if key not in ai_usage:
                ai_usage[key] = {
                    "service": service,
                    "model": model,
                    "input_tokens": 0,
                    "output_tokens": 0,
                    "cost_inr": 0.0,
                    "calls": 0
                }
            ai_usage[key]["calls"] += 1
            ai_usage[key]["cost_inr"] += cost_inr
            ai_usage[key]["input_tokens"] += int(meta.get("tokens_in") or 0)
            ai_usage[key]["output_tokens"] += int(meta.get("tokens_out") or 0)

    ik_breakdown = [{"operation": op, "hits": data["hits"], "cost_inr": round(data["cost_inr"], 4)} for op, data in ik_calls.items()]
    ai_breakdown = [data for data in ai_usage.values()]
    for data in ai_breakdown:
        data["cost_inr"] = round(data["cost_inr"], 4)

    return {
        "runCostInr": round(total_inr, 4),
        "runCostUsd": round(total_usd, 6),
        "runUsageRecordCount": len(rows),
        "ik_total_inr": round(ik_total_inr, 4),
        "ik_breakdown": ik_breakdown,
        "ai_total_inr": round(ai_total_inr, 4),
        "ai_breakdown": ai_breakdown,
    }
