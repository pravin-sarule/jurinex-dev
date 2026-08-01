"""Dead-connection recovery in PostgresStore._run.

The remote Postgres closes idle pooled connections; the first use of such a
connection raises OperationalError. The store must DISCARD that connection
(putconn(close=True)) and retry the operation once on a fresh one — session
saves were silently lost before this behaviour existed.
"""

from __future__ import annotations

import psycopg2
import pytest

import stores


class FakeCursor:
    def __init__(self, conn: "FakeConn") -> None:
        self._conn = conn

    def __enter__(self) -> "FakeCursor":
        return self

    def __exit__(self, *args) -> bool:
        return False

    def execute(self, *args, **kwargs) -> None:
        if self._conn.error is not None:
            raise self._conn.error

    def fetchone(self):
        return ({"payload": True},)


class FakeConn:
    def __init__(self, error: Exception | None = None) -> None:
        self.error = error
        self.committed = False

    def cursor(self) -> FakeCursor:
        return FakeCursor(self)

    def commit(self) -> None:
        self.committed = True

    def rollback(self) -> None:
        pass


class FakePool:
    def __init__(self, conns: list[FakeConn]) -> None:
        self._conns = conns
        self.discarded: list[FakeConn] = []
        self.returned: list[FakeConn] = []

    def getconn(self) -> FakeConn:
        return self._conns.pop(0)

    def putconn(self, conn: FakeConn, close: bool = False) -> None:
        (self.discarded if close else self.returned).append(conn)


@pytest.fixture()
def store(monkeypatch):
    def _with_pool(pool: FakePool) -> stores.PostgresStore:
        s = stores.PostgresStore()
        monkeypatch.setattr(s, "_get", lambda: pool)
        return s
    return _with_pool


def test_dead_connection_discarded_and_retried(store):
    dead = FakeConn(psycopg2.OperationalError("server closed the connection unexpectedly"))
    fresh = FakeConn()
    pool = FakePool([dead, fresh])
    assert store(pool).session_upsert("sid", {"a": 1}) is True
    assert pool.discarded == [dead]      # never recycled back into the pool
    assert pool.returned == [fresh]
    assert fresh.committed


def test_two_dead_connections_return_default(store):
    pool = FakePool([FakeConn(psycopg2.OperationalError("x")),
                     FakeConn(psycopg2.InterfaceError("connection already closed"))])
    assert store(pool).session_select("sid") is None
    assert len(pool.discarded) == 2 and pool.returned == []


def test_non_connection_error_no_retry(store):
    bad = FakeConn(ValueError("boom"))
    spare = FakeConn()
    pool = FakePool([bad, spare])
    assert store(pool).session_upsert("sid", {"a": 1}) is False
    # generic failure: no retry (spare untouched), connection kept in the pool
    assert pool.returned == [bad] and pool.discarded == []


def test_select_success_first_try(store):
    conn = FakeConn()
    pool = FakePool([conn])
    assert store(pool).session_select("sid") == {"payload": True}
    assert pool.returned == [conn]
