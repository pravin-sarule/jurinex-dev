from enum import Enum


class PipelineState(str, Enum):
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
