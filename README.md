# Self Improvement Tracker

Track daily tasks with a calendar view. Two kinds of tasks:

- **Permanent tasks** — added once, show up every day from then on (e.g. "Read 20 pages", "Exercise").
- **One-off tasks** — only show up on the specific day you add them for.

Click any date in the calendar to see/add/check off tasks for that day. Each day's dot shows green when everything is done, yellow when partially done.

## Run locally

```bash
python -m venv venv
venv\Scripts\activate   # on Windows
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Open http://localhost:8000

By default it uses a local SQLite file (`tracker.db`). Set `DATABASE_URL` to a Postgres URL to use Postgres instead.

## Deploy to Render

1. Push this repo to GitHub.
2. In Render, "New +" → "Blueprint", point it at this repo (it will read `render.yaml`).
3. **Important — persistence:** Render's free web service disk is ephemeral (wiped on redeploy/restart). For data that survives, add a free Render PostgreSQL instance and set the `DATABASE_URL` env var on the web service to its connection string. Without that, SQLite data can be lost on redeploy.
4. Deploy. Your app will be live at the Render-provided URL.

## API

- `POST /api/tasks` — create a task `{title, is_permanent, specific_date?}`
- `GET /api/days/{date}` — tasks + completion status for a date
- `POST /api/days/{date}/tasks/{task_id}/completion` — `{completed: true/false}`
- `DELETE /api/tasks/{task_id}` — remove a task entirely
- `POST /api/tasks/{task_id}/archive` — stop a permanent task from future days (keeps history)
- `GET /api/calendar?start=YYYY-MM-DD&end=YYYY-MM-DD` — per-day done/total counts
