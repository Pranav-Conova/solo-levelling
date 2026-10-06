import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest
from fastapi.testclient import TestClient

from tests.conftest import make_app


@pytest.fixture
def app(db_path, monkeypatch):
    # an explicit empty value also stops a developer's local .env from switching the pinger on
    monkeypatch.setenv("PING_URL", "")
    return make_app(db_path)


class _Counter(BaseHTTPRequestHandler):
    hits = 0

    def do_GET(self):  # noqa: N802
        type(self).hits += 1
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"ok")

    def log_message(self, *args):
        pass


@pytest.fixture
def target():
    """A tiny local HTTP server that counts the pings it receives."""
    handler = type("Handler", (_Counter,), {"hits": 0})
    server = HTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_port}/ping", handler
    server.shutdown()


def wait_for(condition, timeout=5.0):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if condition():
            return True
        time.sleep(0.05)
    return False


# ---------- health ----------
def test_health_is_public_and_checks_the_database(app):
    c = TestClient(app)
    r = c.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "database": "ok"}
    assert c.head("/api/health").status_code == 200  # uptime monitors often use HEAD


def test_health_reports_a_broken_database(app):
    from app.database import get_db

    class BrokenSession:
        def execute(self, *_):
            raise RuntimeError("database is down")

    app.dependency_overrides[get_db] = lambda: BrokenSession()
    try:
        r = TestClient(app).get("/api/health")
    finally:
        app.dependency_overrides.clear()
    assert r.status_code == 503 and r.json()["database"] == "unreachable"


# ---------- background pinger ----------
def test_pinger_does_not_run_without_ping_url(app):
    with TestClient(app):
        assert app.state.pinger is None


def test_pinger_ignores_a_url_that_is_not_http(app, monkeypatch):
    monkeypatch.setenv("PING_URL", "ftp://example.com/health")
    with TestClient(app):
        assert app.state.pinger is None


def test_pinger_calls_the_url_repeatedly_and_stops_on_shutdown(app, monkeypatch, target):
    url, handler = target
    monkeypatch.setenv("PING_URL", url)
    monkeypatch.setenv("PING_INTERVAL_SECONDS", "0.2")
    with TestClient(app):
        task = app.state.pinger
        assert task is not None
        assert wait_for(lambda: handler.hits >= 2), f"expected repeated pings, got {handler.hits}"
    assert task.done()  # cancelled cleanly when the app shut down


def test_pinger_survives_an_unreachable_url(app, monkeypatch):
    with socket.socket() as s:  # grab a free port and close it so nothing is listening
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    monkeypatch.setenv("PING_URL", f"http://127.0.0.1:{port}/health")
    monkeypatch.setenv("PING_INTERVAL_SECONDS", "0.1")
    with TestClient(app):
        time.sleep(0.6)  # several failed attempts
        assert not app.state.pinger.done(), "a failing ping must not kill the worker"


def test_default_interval_is_ten_minutes(monkeypatch):
    from app import pinger

    monkeypatch.setenv("PING_URL", "https://example.com/api/health")
    monkeypatch.delenv("PING_INTERVAL_SECONDS", raising=False)
    assert pinger.config_from_env() == ("https://example.com/api/health", 600)
