# Solo Levelling

A self-improvement tracker with an Instagram-style UI. Two kinds of tasks:

- **Daily habits**: added once, show up every day from then on (e.g. "Read 20 pages"). Stopping one keeps its past history.
- **One-off tasks**: only show up on the day you add them for.

## Pages

- **Home**: today's tasks as a feed. Habits appear as "stories" at the top (gradient ring = not done yet). Double-tap a card or tap the heart to complete it.
- **Story viewer**: tap a habit to step through your habits full-screen. Tap right/left to move, hold to pause, swipe down to close. Arrow keys work on desktop.
- **Calendar**: a monthly heatmap of what you got done. Click a day to see, check off or add tasks for it. Swipe or use the arrow keys to change months.
- **Profile**: level, rank (E to S), XP, streaks, a grid of the last 30 days, and your habit list (where you can stop a habit).

You earn 10 XP per completed task and +20 XP for a perfect day. Your streak counts consecutive days with at least one task done.

The layout is responsive. Phones get a bottom tab bar and sheets, tablets get an icon rail, and desktops get a full sidebar plus a progress rail. Light and dark themes follow your system setting, and you can switch them by hand. Animations are skipped when the OS "reduce motion" setting is on.

Colors come from Figma's "Space berries" palette (`#FD3DB5 #FFB8DC #FB6A2C #8C1946`).

## Run locally

```bash
python -m venv venv
venv\Scripts\activate   # on Windows
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Open http://localhost:8000

By default it uses a local SQLite file (`tracker.db`). Set `DATABASE_URL` to a Postgres URL to use Postgres instead. New columns are added automatically on startup, so existing databases keep working.

## Deploy to Render

1. Push this repo to GitHub.
2. In Render, choose "New +" → "Blueprint" and point it at this repo. It reads `render.yaml`.
3. **Important (persistence):** Render's free web service disk is ephemeral and gets wiped on redeploy or restart. To keep your data, create a free Render PostgreSQL instance and set the web service's `DATABASE_URL` env var to its connection string.
4. Deploy.

## API

- `POST /api/tasks`: create a task `{title, is_permanent, specific_date?, start_date?}`
- `GET /api/days/{date}`: tasks and completion status for a date
- `POST /api/days/{date}/tasks/{task_id}/completion`: `{completed: true/false}`
- `DELETE /api/tasks/{task_id}`: delete a task and its history
- `POST /api/tasks/{task_id}/archive?on=YYYY-MM-DD`: stop a daily habit from that day on (history is kept)
- `GET /api/calendar?start=YYYY-MM-DD&end=YYYY-MM-DD`: per-day done/total counts
- `GET /api/habits?today=YYYY-MM-DD`: active habits with streaks
- `GET /api/stats?today=YYYY-MM-DD`: XP, level, rank and streaks
