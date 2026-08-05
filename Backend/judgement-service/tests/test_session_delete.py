"""Deleting a stored research session removes it everywhere (cache +
durable copy) and enforces the same per-user visibility rules as opening
one: owned sessions can only be deleted by their owner."""

import pytest
from fastapi.testclient import TestClient

from api import app
from stores import postgres, sessions

client = TestClient(app)


@pytest.fixture(autouse=True)
def _fake_db(monkeypatch):
    """Cache-only store: the durable layer is faked so tests never touch
    (or race with) a real database."""
    monkeypatch.setattr(postgres, "session_upsert", lambda sid, payload: True)
    monkeypatch.setattr(postgres, "session_select", lambda sid: None)
    monkeypatch.setattr(postgres, "session_delete", lambda sid: True)


def _seed(session_id: str, user_id: str | None = None) -> None:
    payload = {
        "caseContext": {"document_type": "note"},
        "suggestedIssues": [],
        "issues": [],
    }
    if user_id:
        payload["userId"] = user_id
    sessions.save(session_id, payload)


def test_delete_unknown_session_404():
    assert client.delete("/api/v1/search/doesnotexist999").status_code == 404


def test_owner_deletes_and_session_is_gone():
    _seed("delsession1", user_id="user-1")
    resp = client.delete("/api/v1/search/delsession1", headers={"X-User-Id": "user-1"})
    assert resp.status_code == 200
    assert resp.json() == {"deleted": True, "sessionId": "delsession1"}
    assert sessions.load("delsession1") is None
    assert client.get("/api/v1/search/delsession1",
                      headers={"X-User-Id": "user-1"}).status_code == 404


def test_non_owner_cannot_delete():
    _seed("delsession2", user_id="user-1")
    # Wrong user → 404, session untouched.
    assert client.delete("/api/v1/search/delsession2",
                         headers={"X-User-Id": "user-2"}).status_code == 404
    assert sessions.load("delsession2") is not None
    # No header at all → same.
    assert client.delete("/api/v1/search/delsession2").status_code == 404
    assert sessions.load("delsession2") is not None


def test_legacy_unowned_session_deletable_by_direct_id():
    # Mirrors GET: unowned sessions stay reachable (and removable) by id.
    _seed("delsession3", user_id=None)
    resp = client.delete("/api/v1/search/delsession3")
    assert resp.status_code == 200
    assert sessions.load("delsession3") is None


def test_db_failure_reports_500_when_postgres_up(monkeypatch):
    _seed("delsession4", user_id="user-1")
    monkeypatch.setattr(postgres, "session_delete", lambda sid: False)
    monkeypatch.setattr(type(postgres), "available",
                        property(lambda self: True), raising=False)
    resp = client.delete("/api/v1/search/delsession4", headers={"X-User-Id": "user-1"})
    assert resp.status_code == 500
