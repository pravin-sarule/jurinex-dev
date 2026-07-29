"""Search-within-search over a canned session: reorder / de-emphasise,
NEVER hard-delete; escape hatch offered only when nothing matches."""

from fastapi.testclient import TestClient

from api import app
from stores import sessions

client = TestClient(app)


def _seed_session() -> str:
    session_id = "testsession123"
    results = [
        {"docId": "1", "title": "State of Haryana v. Bhajan Lal", "court": "Supreme Court of India",
         "year": 1992, "band": "GREEN", "score": 0.88, "redFlag": False,
         "pinpoint": "para 102: categories where FIR may be quashed", "url": "",
         "signals": {"semantic": 0.9, "keyword": 0.7}, "chips": ["Supreme Court"]},
        {"docId": "2", "title": "Neeharika Infrastructure v. State of Maharashtra",
         "court": "Supreme Court of India", "year": 2021, "band": "GREEN", "score": 0.84,
         "redFlag": False, "pinpoint": None, "url": "",
         "signals": {"semantic": 0.85, "keyword": 0.6}, "chips": ["Supreme Court"]},
        {"docId": "3", "title": "Some HC matter", "court": "Bombay High Court",
         "year": 2010, "band": "YELLOW", "score": 0.71, "redFlag": False,
         "pinpoint": None, "url": "",
         "signals": {"semantic": 0.76, "keyword": 0.4}, "chips": ["High Court"]},
    ]
    sessions.save(session_id, {
        "caseContext": {"document_type": "note"},
        "suggestedIssues": [{"id": 1, "issue": "Whether the FIR is liable to be quashed"}],
        "issues": [{
            "id": 1, "issue": "Whether the FIR is liable to be quashed",
            "results": results,
            "candidateMeta": {
                "1": {"title": "Bhajan Lal", "headline": "quashing categories", "court": "SC",
                      "year": 1992, "numCitedby": 5000},
                "2": {"title": "Neeharika", "headline": "interim protection quashing", "court": "SC",
                      "year": 2021, "numCitedby": 800},
                "3": {"title": "HC matter", "headline": "some snippet", "court": "Bom HC",
                      "year": 2010, "numCitedby": 3},
            },
        }],
    })
    return session_id


def test_facet_mode_reorders_but_never_deletes():
    session_id = _seed_session()
    resp = client.post(f"/api/v1/search/{session_id}/refine",
                       json={"issueId": 1, "mode": "facet", "query": "Supreme Court after 2015"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["matchedCount"] == 1  # only Neeharika (SC + after 2015)
    assert len(body["items"]) == 3    # nothing hard-deleted
    assert body["items"][0]["result"]["docId"] == "2"
    demoted = [i for i in body["items"] if i["demoted"]]
    assert {i["result"]["docId"] for i in demoted} == {"1", "3"}
    assert body["escapeHatch"] is None


def test_keyword_mode_matches_cached_text_only():
    session_id = _seed_session()
    resp = client.post(f"/api/v1/search/{session_id}/refine",
                       json={"issueId": 1, "mode": "keyword", "query": "Bhajan quashed"})
    body = resp.json()
    assert body["matchedCount"] == 1
    assert body["items"][0]["result"]["docId"] == "1"
    assert len(body["items"]) == 3


def test_zero_matches_offers_ik_escape_hatch():
    session_id = _seed_session()
    resp = client.post(f"/api/v1/search/{session_id}/refine",
                       json={"issueId": 1, "mode": "keyword", "query": "arbitration kompetenz"})
    body = resp.json()
    assert body["matchedCount"] == 0
    assert len(body["items"]) == 3  # still all there, demoted
    assert body["escapeHatch"]["how"]["mode"] == "ik_escape"


def test_unknown_session_404():
    resp = client.post("/api/v1/search/doesnotexist/refine",
                       json={"issueId": 1, "mode": "facet", "query": ""})
    assert resp.status_code == 404


def test_search_requires_input():
    resp = client.post("/api/v1/search", json={"caseInput": {}})
    assert resp.status_code == 400


def test_search_run_requires_known_session():
    resp = client.post("/api/v1/search/nope/run", json={"customIssues": ["x"]})
    assert resp.status_code == 404


def test_health():
    resp = client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert "phaseWeights" in body and "stores" in body
