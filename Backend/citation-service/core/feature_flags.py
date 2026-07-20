from core.config import settings


def use_v2_pipeline() -> bool:
    return settings.pipeline_version == "v2"
