import importlib
import os
import sqlite3
from datetime import date

import pytest
from fastapi.testclient import TestClient

HDR = {"X-Requested-With": "fetch"}
TODAY = date.today().isoformat()


def make_app(db_path, **env):
    """Import a fresh copy of the app bound to its own SQLite file."""
    os.environ["DATABASE_URL"] = f"sqlite:///{db_path}"
    for k, v in env.items():
        os.environ[k] = v
    import app.database, app.models, app.auth, app.crud, app.main  # noqa: E401
    for mod in (app.database, app.models, app.auth, app.crud, app.main):
        importlib.reload(mod)
    for k in env:
        del os.environ[k]
    return app.main.app


@pytest.fixture
def db_path(tmp_path):
    yield str(tmp_path / "test.db")
    import app.database
    app.database.engine.dispose()  # release the SQLite file (Windows won't delete open files)


@pytest.fixture
def client(db_path):
    return TestClient(make_app(db_path))


def register(c, name="jinwoo", pw="shadow-monarch"):
    return c.post("/api/auth/register", json={"username": name, "password": pw}, headers=HDR)


def add_quest(c, title="Study"):
    return c.post("/api/tasks", json={"title": title, "is_permanent": True, "start_date": TODAY}, headers=HDR)


def test_quests_require_login(client):
    assert client.get(f"/api/days/{TODAY}").status_code == 401
    assert client.get("/api/stats").status_code == 401
    assert add_quest(client).status_code == 401


def test_register_sets_httponly_session_and_me(client):
    r = register(client, name="Jinwoo")
    assert r.status_code == 200
    assert r.json()["username"] == "jinwoo"  # names are case-insensitive
    cookie = r.headers["set-cookie"].lower()
    assert "sl_session=" in cookie and "httponly" in cookie and "samesite=lax" in cookie
    assert client.get("/api/auth/me").json()["authenticated"] is True


def test_password_is_hashed(client, db_path):
    register(client, pw="shadow-monarch")
    stored = sqlite3.connect(db_path).execute("select password_hash from users").fetchone()[0]
    assert "shadow-monarch" not in stored and stored.startswith("scrypt$")


def test_duplicate_and_invalid_registration(client):
    assert register(client).status_code == 200
    other = TestClient(client.app)
    assert register(other, name="JINWOO").status_code == 409
    assert register(other, name="ab").status_code == 422          # too short
    assert register(other, name="bad name!").status_code == 422   # bad characters
    assert register(other, name="hae-in", pw="short").status_code == 422


def test_players_cannot_see_or_touch_each_others_quests(client):
    register(client, name="jinwoo")
    quest_id = add_quest(client, "Jinwoo's quest").json()["id"]

    other = TestClient(client.app)
    register(other, name="haein")
    assert other.get(f"/api/days/{TODAY}").json()["tasks"] == []
    assert other.post(f"/api/days/{TODAY}/tasks/{quest_id}/completion", json={"completed": True}, headers=HDR).status_code == 404
    assert other.delete(f"/api/tasks/{quest_id}", headers=HDR).status_code == 404
    assert other.post(f"/api/tasks/{quest_id}/archive", headers=HDR).status_code == 404
    assert other.get("/api/stats").json()["total_done"] == 0

    # still intact for its owner
    assert [t["title"] for t in client.get(f"/api/days/{TODAY}").json()["tasks"]] == ["Jinwoo's quest"]


def test_login_logout_and_wrong_password(client):
    register(client)
    client.post("/api/auth/logout", headers=HDR)
    assert client.get("/api/auth/me").json()["authenticated"] is False
    assert client.get(f"/api/days/{TODAY}").status_code == 401

    bad = client.post("/api/auth/login", json={"username": "jinwoo", "password": "wrong-password"}, headers=HDR)
    assert bad.status_code == 401
    unknown = client.post("/api/auth/login", json={"username": "nobody", "password": "whatever1"}, headers=HDR)
    assert unknown.status_code == 401 and unknown.json()["detail"] == bad.json()["detail"]  # no user enumeration

    ok = client.post("/api/auth/login", json={"username": "JinWoo", "password": "shadow-monarch"}, headers=HDR)
    assert ok.status_code == 200 and ok.json()["authenticated"] is True


def test_logout_invalidates_the_session_server_side(client):
    register(client)
    token = client.cookies.get("sl_session")
    client.post("/api/auth/logout", headers=HDR)
    replay = TestClient(client.app, cookies={"sl_session": token})
    assert replay.get("/api/auth/me").json()["authenticated"] is False


def test_repeated_failures_are_throttled(client):
    register(client)
    other = TestClient(client.app)
    for _ in range(5):
        assert other.post("/api/auth/login", json={"username": "jinwoo", "password": "nope-nope"}, headers=HDR).status_code == 401
    r = other.post("/api/auth/login", json={"username": "jinwoo", "password": "shadow-monarch"}, headers=HDR)
    assert r.status_code == 429  # even the right password waits out the lockout


def test_change_password_signs_out_other_devices(client):
    register(client)
    phone = TestClient(client.app)
    phone.post("/api/auth/login", json={"username": "jinwoo", "password": "shadow-monarch"}, headers=HDR)
    wrong = client.post("/api/auth/password", json={"current_password": "nope", "new_password": "arise-arise"}, headers=HDR)
    assert wrong.status_code == 400
    ok = client.post("/api/auth/password", json={"current_password": "shadow-monarch", "new_password": "arise-arise"}, headers=HDR)
    assert ok.status_code == 200
    assert client.get("/api/auth/me").json()["authenticated"] is True   # this device stays in
    assert phone.get("/api/auth/me").json()["authenticated"] is False   # others are signed out
    fresh = TestClient(client.app)
    assert fresh.post("/api/auth/login", json={"username": "jinwoo", "password": "arise-arise"}, headers=HDR).status_code == 200


def test_mutations_need_the_csrf_header(client):
    register(client)
    assert client.post("/api/tasks", json={"title": "x", "is_permanent": True}).status_code == 403
    assert client.post("/api/auth/logout").status_code == 403


def test_first_account_claims_quests_from_before_accounts(db_path):
    # a database from before accounts existed: tasks without any owner column
    con = sqlite3.connect(db_path)
    con.executescript(f"""
        CREATE TABLE tasks (id INTEGER PRIMARY KEY, title VARCHAR NOT NULL, is_permanent BOOLEAN NOT NULL,
                            specific_date DATE, start_date DATE NOT NULL, archived BOOLEAN NOT NULL);
        CREATE TABLE completions (id INTEGER PRIMARY KEY, task_id INTEGER NOT NULL, date DATE NOT NULL,
                                  completed BOOLEAN NOT NULL, UNIQUE(task_id, date));
        INSERT INTO tasks VALUES (1, 'Old quest', 1, NULL, '{TODAY}', 0);
    """)
    con.commit()
    con.close()
    c = TestClient(make_app(db_path))
    register(c, name="owner")
    assert [t["title"] for t in c.get(f"/api/days/{TODAY}").json()["tasks"]] == ["Old quest"]
    second = TestClient(c.app)
    register(second, name="guest")
    assert second.get(f"/api/days/{TODAY}").json()["tasks"] == []


def test_registration_can_be_closed_after_the_first_account(db_path):
    c = TestClient(make_app(db_path, ALLOW_REGISTRATION="false"))
    assert c.get("/api/auth/me").json()["registration_open"] is True   # first account always allowed
    assert register(c, name="owner").status_code == 200
    other = TestClient(c.app)
    assert other.get("/api/auth/me").json()["registration_open"] is False
    assert register(other, name="stranger").status_code == 403
