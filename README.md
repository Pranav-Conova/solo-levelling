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

## Deploy to Render

1. Push this repo to GitHub.
2. In Render, choose "New +" → "Blueprint" and point it at this repo. It reads `render.yaml`.
3. **Important (persistence):** Render's free web service disk is ephemeral and gets wiped on redeploy or restart. To keep your data, create a free Render PostgreSQL instance and set the web service's `DATABASE_URL` env var to its connection string.
4. Deploy.

## Tests

```bash
pip install -r requirements-dev.txt
pytest
```

## API

All quest endpoints require a logged-in session.

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
