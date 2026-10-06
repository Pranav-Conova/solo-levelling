# Solo Levelling

A self-improvement tracker styled after the System from the *Solo Leveling* anime: glowing blue System windows that hand you a Daily Quest, warn you about penalties and level you up.

Quests are plain text, so they can be anything: "Study for 1 hour", "Read 20 pages", "Call mom". Each quest is either:

- **Daily Quest**: arrives every day from the day you create it. Abandoning it keeps its past record.
- **Personal quest**: belongs to a single day.

## Accounts

Every Player signs in with a name and password, and each Player only ever sees their own quests.

- The awakening is the sign-up: "Please enter your name and a password, Player." Returning Players get the **Identification** window.
- Passwords are hashed with scrypt (salted, standard library). Sessions are random tokens in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` over HTTPS), stored hashed on the server and valid for 30 days.
- Repeated wrong passwords are throttled: 5 per name and IP, or 20 per name, in 15 minutes.
- State-changing API calls must send `X-Requested-With: fetch`, a CSRF guard on top of the SameSite cookie.
- Change your password or log out from **Status**. Changing your password signs out your other devices.
- **Upgrading an existing install:** quests created before accounts existed are claimed by the first account you create.
- Set `ALLOW_REGISTRATION=false` once your own account exists to stop strangers from signing up. The first account can always be created.

## Screens

- **Awakening** (first visit): *"You have acquired the qualifications to be a Player. Will you accept?"* Decline at your own risk. You then pick a name and password, which creates your account, and the Daily Quest arrives.
- **Quest Info** (home): `[Daily Quest has arrived.]`, the GOAL list with `[Complete]`/`[Incomplete]` and checkboxes, the penalty warning, and a countdown to the daily reset at local midnight.
- **Quest Complete**: a rewards window when you clear every quest for the day.
- **Penalty**: a red window the next morning if you left quests unfinished yesterday.
- **Level Up**: a notification when your EXP crosses into a new level.
- **Quest Log** (calendar): a monthly record. Tap a day to see, check off or add quests for it.
- **Status** (profile): Name, Job, Title (rank E to S), Level, HP/MP bars and STR/AGI/VIT/INT/PER. Every stat comes from your real record, and the screen labels which number drives each one. You can also turn the System sound off here.

Quests give 10 EXP each, plus a 20 EXP bonus for a perfect day. Your streak counts consecutive days with at least one quest cleared.

The layout works on phones and desktops. System windows unfold from a line, text types itself out, and a soft "ding" plays (synthesised in the browser, with a mute toggle). All animation is skipped when the OS "reduce motion" setting is on.

All colours are CSS variables in one block at the top of `static/style.css`.

## Run locally

```bash
python -m venv venv
venv\Scripts\activate   # on Windows
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Open http://localhost:8000

By default it uses a local SQLite file (`tracker.db`). Set `DATABASE_URL` to a Postgres URL to use Postgres instead. New columns are added automatically on startup, so existing databases keep working.

## Health check and background pinger

- `GET /api/health` (also `HEAD`) needs no login. It returns `{"status": "ok", "database": "ok"}`, or HTTP 503 if the database can't be reached. Render uses it as the service health check (`healthCheckPath` in `render.yaml`).
- **Background pinger:** set `PING_URL` and the app calls that URL every 10 minutes for as long as it runs. If `PING_URL` is unset or empty, the worker isn't started. Failed requests are logged and retried on the next tick, and never crash the app.
- On Render's free plan, an idle service sleeps after about 15 minutes. Setting `PING_URL=https://<your-service>.onrender.com/api/health` keeps it awake (one always-on service fits in the free 750 hours a month).
- `PING_INTERVAL_SECONDS` optionally overrides the 10 minutes. It's mainly for testing.
- Settings can live in a `.env` file locally (see `.env.example`). Real environment variables take priority.
- If you run uvicorn with several `--workers`, each worker pings on its own.

## Deploy to Render

1. Push this repo to GitHub.
2. In Render, choose "New +" → "Blueprint" and point it at this repo. It reads `render.yaml`. If you create a plain Web Service instead, set the start command to `uvicorn app.main:app --host 0.0.0.0 --port $PORT`, the health check path to `/api/health`, and the env vars yourself. Python is pinned by `.python-version`.
3. **Database: SQLite for now.** With no `DATABASE_URL`, the app stores everything in `tracker.db`. On Render's free plan the disk is temporary, so **that file, and every account and quest in it, is reset on each deploy or restart.** Setting `PING_URL` avoids the idle restarts, but deploys still wipe it.
   - To keep SQLite data: add a persistent disk (paid plan), for example mounted at `/var/data`, and set `DATABASE_URL=sqlite:////var/data/tracker.db`.
   - Or switch to Postgres later by setting `DATABASE_URL` to its connection string. The tables are created automatically.
4. Deploy.

## Tests

```bash
pip install -r requirements-dev.txt
pytest
```

## API

All quest endpoints require a logged-in session.

- `GET /api/health`: health check (public)

- `GET /api/auth/me`: session state (plus whether sign-up is open)
- `POST /api/auth/register` / `POST /api/auth/login`: `{username, password}`
- `POST /api/auth/logout`
- `POST /api/auth/password`: `{current_password, new_password}`

- `POST /api/tasks`: create a quest `{title, is_permanent, specific_date?, start_date?}`
- `GET /api/days/{date}`: quests and completion for a date
- `POST /api/days/{date}/tasks/{task_id}/completion`: `{completed: true/false}`
- `DELETE /api/tasks/{task_id}`: delete a quest and its history
- `POST /api/tasks/{task_id}/archive?on=YYYY-MM-DD`: stop a Daily Quest from that day on (history is kept)
- `GET /api/calendar?start=YYYY-MM-DD&end=YYYY-MM-DD`: per-day cleared/total counts
- `GET /api/habits?today=YYYY-MM-DD`: active Daily Quests with streaks
- `GET /api/stats?today=YYYY-MM-DD`: EXP, level, rank and streaks
