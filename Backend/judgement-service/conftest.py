import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


@pytest.fixture(autouse=True)
def _offline_library(monkeypatch):
    """Tests never touch the live Elasticsearch library (.env carries real
    credentials): the library-first paths see an empty library and fall
    through to the (mocked) Indian Kanoon flow. Library-specific tests
    re-monkeypatch these with their own data."""
    import tools
    monkeypatch.setattr(tools, "es_wire_search", lambda wire, size=10, pagenum=0: [])
    monkeypatch.setattr(tools, "es_get_judgment", lambda doc_id: None)
    monkeypatch.setattr(tools, "es_search_cache_get", lambda wire: [])
    import stores
    monkeypatch.setattr(stores.elastic, "search_cache_put",
                        lambda wire, pagenum, docs: None)
