import sqlite3
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from tests.conftest import make_app

HDR = {"X-Requested-With": "fetch"}
TODAY = date.today()


def d(offset: int) -> str:
    return (TODAY + timedelta(days=offset)).isoformat()


@pytest.fixture
def client(db_path, monkeypatch):
    monkeypatch.setenv("PING_URL", "")
    c = TestClient(make_app(db_path))
    c.post("/api/auth/register", json={"username": "jinwoo", "password": "shadow-monarch"}, headers=HDR)
    return c


def quest(c, title, every, start_offset=0):
    r = c.post("/api/tasks", json={"title": title, "is_permanent": True, "start_date": d(start_offset),
                                   "interval_days": every}, headers=HDR)
    assert r.status_code == 200, r.text
    return r.json()["id"]


def titles_on(c, offset):
    return [t["title"] for t in c.get(f"/api/days/{d(offset)}").json()["tasks"]]


def complete(c, offset, task_id, done=True):
    return c.post(f"/api/days/{d(offset)}/tasks/{task_id}/completion", json={"completed": done}, headers=HDR)


# ---------- every-N-day quests ----------
def test_quest_only_appears_on_its_scheduled_days(client):
    quest(client, "Gym", every=2, start_offset=-4)        # due -4, -2, 0, 2...
    quest(client, "Long run", every=5, start_offset=-5)   # due -5, 0, 5...
    quest(client, "Read", every=1, start_offset=-5)

    assert titles_on(client, 0) == ["Gym", "Long run", "Read"]
    assert titles_on(client, -1) == ["Read"]
    assert titles_on(client, -2) == ["Gym", "Read"]
    assert titles_on(client, 5) == ["Long run", "Read"]
    assert titles_on(client, -6) == []  # nothing before the start


def test_task_out_reports_the_interval(client):
    quest(client, "Gym", every=3)
    assert client.get(f"/api/days/{d(0)}").json()["tasks"][0]["interval_days"] == 3


def test_cannot_complete_on_an_off_day(client):
    gym = quest(client, "Gym", every=2, start_offset=-1)  # due -1, 1, 3...
    assert complete(client, 0, gym).status_code == 404
    assert complete(client, -1, gym).status_code == 200


def test_interval_validation(client):
    for bad in (0, -2, 366):
        r = client.post("/api/tasks", json={"title": "x", "is_permanent": True, "interval_days": bad}, headers=HDR)
        assert r.status_code == 422


def test_streak_counts_scheduled_runs_and_ignores_off_days(client):
    gym = quest(client, "Gym", every=3, start_offset=-9)  # due -9, -6, -3, 0
    for off in (-9, -6, -3):
        assert complete(client, off, gym).status_code == 200
    habit = client.get("/api/habits", params={"today": d(0)}).json()[0]
    assert habit["streak"] == 3                  # today's run still open, streak alive
    assert habit["due_today"] is True and habit["next_due"] == d(0)

    complete(client, 0, gym)
    habit = client.get("/api/habits", params={"today": d(0)}).json()[0]
    assert habit["streak"] == 4 and habit["completed_today"] is True
    assert habit["next_due"] == d(3)             # done today -> next run in 3 days


def test_missed_run_breaks_the_streak(client):
    gym = quest(client, "Gym", every=2, start_offset=-6)  # due -6, -4, -2, 0
    complete(client, -6, gym)
    complete(client, -2, gym)                             # -4 missed
    habit = client.get("/api/habits", params={"today": d(0)}).json()[0]
    assert habit["streak"] == 1


def test_next_due_on_an_off_day(client):
    quest(client, "Long run", every=5, start_offset=-2)  # due -2, 3
    habit = client.get("/api/habits", params={"today": d(0)}).json()[0]
    assert habit["due_today"] is False and habit["next_due"] == d(3)


def test_calendar_counts_only_scheduled_days(client):
    quest(client, "Gym", every=2, start_offset=-4)
    days = {x["date"]: x["total"] for x in client.get("/api/calendar", params={"start": d(-4), "end": d(0)}).json()}
    assert [days[d(o)] for o in range(-4, 1)] == [1, 0, 1, 0, 1]


def test_old_databases_get_daily_quests(db_path, monkeypatch):
    """Quests from before intervals existed keep showing every day."""
    monkeypatch.setenv("PING_URL", "")
    make_app(db_path)  # creates the current schema
    con = sqlite3.connect(db_path)
    con.execute("ALTER TABLE tasks DROP COLUMN interval_days")
    con.execute("INSERT INTO tasks (title, is_permanent, start_date, archived) VALUES ('Old quest', 1, ?, 0)", (d(-3),))
    con.commit()
    con.close()
    c = TestClient(make_app(db_path))
    c.post("/api/auth/register", json={"username": "owner", "password": "shadow-monarch"}, headers=HDR)
    assert titles_on(c, -1) == ["Old quest"] and titles_on(c, 0) == ["Old quest"]


# ---------- job applications ----------
def test_application_crud(client):
    r = client.post("/api/applications", json={"company": "  Hunters Guild ", "role": "Backend Engineer",
                                                "applied_via": "Referral"}, headers=HDR)
    assert r.status_code == 201
    app_ = r.json()
    assert app_["company"] == "Hunters Guild" and app_["status"] == "applied" and app_["applied_on"] == d(0)

    r = client.patch(f"/api/applications/{app_['id']}", json={"status": "interviewing"}, headers=HDR)
    assert r.status_code == 200 and r.json()["status"] == "interviewing" and r.json()["role"] == "Backend Engineer"

    client.post("/api/applications", json={"company": "Ahjin Guild", "role": "SRE", "applied_on": d(-10)}, headers=HDR)
    listed = client.get("/api/applications").json()
    assert [a["company"] for a in listed] == ["Hunters Guild", "Ahjin Guild"]  # newest first

    assert client.delete(f"/api/applications/{app_['id']}", headers=HDR).status_code == 200
    assert [a["company"] for a in client.get("/api/applications").json()] == ["Ahjin Guild"]


def test_application_validation(client):
    def post(**body):
        return client.post("/api/applications", json={"company": "X", "role": "Y", **body}, headers=HDR)

    assert post(status="hired?").status_code == 422
    assert post(company="   ").status_code == 422
    assert post(role="").status_code == 422
    assert post(applied_via="x" * 61).status_code == 422
    ok = post().json()
    assert client.patch(f"/api/applications/{ok['id']}", json={"company": "  "}, headers=HDR).status_code == 422


def test_applications_are_private(client):
    mine = client.post("/api/applications", json={"company": "Secret Co", "role": "Dev"}, headers=HDR).json()
    other = TestClient(client.app)
    other.post("/api/auth/register", json={"username": "haein", "password": "another-pass"}, headers=HDR)
    assert other.get("/api/applications").json() == []
    assert other.patch(f"/api/applications/{mine['id']}", json={"status": "offer"}, headers=HDR).status_code == 404
    assert other.delete(f"/api/applications/{mine['id']}", headers=HDR).status_code == 404
    assert TestClient(client.app).get("/api/applications").status_code == 401
