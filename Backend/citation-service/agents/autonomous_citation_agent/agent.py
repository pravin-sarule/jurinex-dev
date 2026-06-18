"""
Autonomous Citation Research Agent — architecture reference.

  INPUT  — case query + case context
  GATE   — Case Analyzer (issues, parties, jurisdiction)
  LOOP   — Budget Guard → Query Planner → Search → Allowlist → Extractor → Critic
  Stage 6 — Verification + Confidence Grading (HIGH / MEDIUM / BLOCKED)
  OUTPUT — verified citations + research gaps

Runtime orchestration: runner.run_autonomous_pipeline()
"""
from agents.autonomous_citation_agent.runner import run_autonomous_pipeline

citation_root_agent = None
