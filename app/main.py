import os
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from fastapi import FastAPI, Depends, HTTPException, Request, Response
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import auth, crud, models, schemas
from .auth import current_user
from .database import Base, engine, get_db

Base.metadata.create_all(bind=engine)


def _migrate():
    # create_all never alters existing tables, so add columns introduced after the first release
    columns = {c["name"] for c in inspect(engine).get_columns("tasks")}
    with engine.begin() as conn:
        if "archived_on" not in columns:
            conn.execute(text("ALTER TABLE tasks ADD COLUMN archived_on DATE"))
            # tasks archived before archived_on existed were hidden on every day
            conn.execute(text("UPDATE tasks SET archived_on = start_date WHERE archived = :yes"), {"yes": True})
        if "user_id" not in columns:
            # existing quests stay unowned until the first account claims them
            conn.execute(text("ALTER TABLE tasks ADD COLUMN user_id INTEGER REFERENCES users(id)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_tasks_user_id ON tasks (user_id)"))


_migrate()

# Set ALLOW_REGISTRATION=false once your own account exists to stop strangers signing up.
# The very first account can always be created, so a fresh deploy is never locked out.
ALLOW_REGISTRATION = os.getenv("ALLOW_REGISTRATION", "true").strip().lower() not in {"0", "false", "no", "off"}

app = FastAPI(title="Solo Levelling")


@app.middleware("http")
async def guard_and_cache(request: Request, call_next):
    # CSRF defence in depth (the session cookie is already SameSite=Lax): browsers won't let another
    # site attach a custom header to a cross-origin request without a CORS preflight we never approve
    if request.url.path.startswith("/api/") and request.method not in {"GET", "HEAD", "OPTIONS"}:
        if request.headers.get("x-requested-with") != "fetch":
            return JSONResponse({"detail": "Missing X-Requested-With header"}, status_code=403)
    response = await call_next(request)
    # JS modules import each other without version tags, so make browsers check for new deploys
    if request.url.path.startswith("/static/"):
        response.headers["Cache-Control"] = "no-cache"
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


# ---------- accounts ----------
def _registration_open(db: Session) -> bool:
    return ALLOW_REGISTRATION or db.query(models.User).first() is None


def _me(db: Session, user: models.User | None) -> schemas.Me:
    return schemas.Me(
        authenticated=user is not None,
        username=user.username if user else None,
        registration_open=_registration_open(db),
        has_users=db.query(models.User).first() is not None,
    )


@app.get("/api/auth/me", response_model=schemas.Me)
def me(db: Session = Depends(get_db), user: models.User | None = Depends(auth.optional_user)):
    return _me(db, user)


@app.post("/api/auth/register", response_model=schemas.Me)
def register(body: schemas.Credentials, request: Request, response: Response, db: Session = Depends(get_db)):
    if not _registration_open(db):
        raise HTTPException(status_code=403, detail="New Players can't register on this System.")
    ip_key = f"signup:{auth.client_ip(request)}"
    wait = auth.signup_throttle.retry_after(ip_key)
    if wait:
        raise HTTPException(status_code=429, detail=f"Too many sign-ups. Try again in {wait // 60 + 1} minutes.")
    if db.query(models.User).filter(models.User.username == body.username).first():
        raise HTTPException(status_code=409, detail="That name is already taken by another Player.")
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    try:
        user = crud.create_user(db, body.username, auth.hash_password(body.password), now)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="That name is already taken by another Player.")
    auth.signup_throttle.hit(ip_key)
    auth.start_session(db, user, request, response)
    return _me(db, user)


@app.post("/api/auth/login", response_model=schemas.Me)
def login(body: schemas.LoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    username = body.username.strip().lower()
    pair_key = f"login:{username}:{auth.client_ip(request)}"
    account_key = f"account:{username}"
    wait = max(auth.login_throttle.retry_after(pair_key), auth.account_throttle.retry_after(account_key))
    if wait:
        raise HTTPException(status_code=429, detail=f"Too many failed attempts. Try again in {wait // 60 + 1} minutes.")
    user = auth.check_credentials(db, username, body.password)
    if user is None:
        auth.login_throttle.hit(pair_key)
        auth.account_throttle.hit(account_key)
        raise HTTPException(status_code=401, detail="Wrong name or password.")
    auth.login_throttle.reset(pair_key)
    auth.start_session(db, user, request, response)
    return _me(db, user)


@app.post("/api/auth/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    auth.end_session(db, request, response)
    return {"ok": True}


@app.post("/api/auth/password")
def change_password(body: schemas.PasswordChange, request: Request, db: Session = Depends(get_db),
                    user: models.User = Depends(current_user)):
    if not auth.verify_password(body.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Your current password is incorrect.")
    user.password_hash = auth.hash_password(body.new_password)
    db.commit()
    auth.end_other_sessions(db, user, request)  # sign out every other device
    return {"ok": True}


# ---------- quests (all scoped to the logged-in Player) ----------
def _task_out(db: Session, task: models.Task, user_id: int) -> schemas.TaskOut:
    day = crud.get_day(db, task.start_date, user_id)
    for t in day.tasks:
        if t.id == task.id:
            return t
    raise HTTPException(status_code=500, detail="Task created but not found")


@app.post("/api/tasks", response_model=schemas.TaskOut)
def create_task(task_in: schemas.TaskCreate, db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    if not task_in.title.strip():
        raise HTTPException(status_code=422, detail="Title can't be empty")
    task = crud.create_task(db, task_in, user.id)
    return _task_out(db, task, user.id)


@app.delete("/api/tasks/{task_id}")
def delete_task(task_id: int, db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    if not crud.delete_task(db, task_id, user.id):
        raise HTTPException(status_code=404, detail="Task not found")
    return {"ok": True}


@app.post("/api/tasks/{task_id}/archive")
def archive_task(task_id: int, on: Optional[date] = None, db: Session = Depends(get_db),
                 user: models.User = Depends(current_user)):
    """Stop a permanent task from `on` onwards (default today); earlier days keep their history."""
    if crud.archive_task(db, task_id, on or date.today(), user.id) is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"ok": True}


@app.get("/api/days/{target_date}", response_model=schemas.DayTasks)
def get_day(target_date: date, db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    return crud.get_day(db, target_date, user.id)


@app.post("/api/days/{target_date}/tasks/{task_id}/completion", response_model=schemas.TaskOut)
def set_completion(target_date: date, task_id: int, body: schemas.CompletionUpdate, db: Session = Depends(get_db),
                   user: models.User = Depends(current_user)):
    # one day of slack because the server's clock (UTC on Render) can be behind the user's
    if target_date > date.today() + timedelta(days=1):
        raise HTTPException(status_code=400, detail="Can't complete a task in the future")
    task = crud.get_owned_task(db, task_id, user.id)
    if task is None or not task.applies_to(target_date):
        raise HTTPException(status_code=404, detail="Task not found for this date")
    crud.set_completion(db, task_id, target_date, body.completed)
    day = crud.get_day(db, target_date, user.id)
    for t in day.tasks:
        if t.id == task_id:
            return t
    raise HTTPException(status_code=404, detail="Task not found for this date")


@app.get("/api/calendar", response_model=list[schemas.CalendarDay])
def get_calendar(start: date, end: date, db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    if end < start:
        raise HTTPException(status_code=400, detail="end must be >= start")
    if (end - start).days > 400:
        raise HTTPException(status_code=400, detail="Range too large (max 400 days)")
    return crud.get_calendar_summary(db, start, end, user.id)


@app.get("/api/habits", response_model=list[schemas.HabitOut])
def get_habits(today: Optional[date] = None, db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    return crud.get_habits(db, today or date.today(), user.id)


@app.get("/api/stats", response_model=schemas.Stats)
def get_stats(today: Optional[date] = None, db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    return crud.get_stats(db, today or date.today(), user.id)


app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/")
def index():
    return FileResponse("static/index.html", headers={"Cache-Control": "no-cache"})
