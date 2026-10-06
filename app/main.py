from datetime import date, timedelta
from typing import Optional

from fastapi import FastAPI, Depends, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from . import crud, models, schemas
from .database import Base, engine, get_db

Base.metadata.create_all(bind=engine)


def _migrate():
    # create_all never alters existing tables, so add columns introduced after the first release
    columns = {c["name"] for c in inspect(engine).get_columns("tasks")}
    if "archived_on" not in columns:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE tasks ADD COLUMN archived_on DATE"))
            # tasks archived before archived_on existed were hidden on every day
            conn.execute(text("UPDATE tasks SET archived_on = start_date WHERE archived = :yes"), {"yes": True})


_migrate()

app = FastAPI(title="Solo Levelling")


@app.middleware("http")
async def revalidate_static(request, call_next):
    # JS modules import each other without version tags, so make browsers check for new deploys
    response = await call_next(request)
    if request.url.path.startswith("/static/"):
        response.headers["Cache-Control"] = "no-cache"
    return response


@app.post("/api/tasks", response_model=schemas.TaskOut)
def create_task(task_in: schemas.TaskCreate, db: Session = Depends(get_db)):
    if not task_in.title.strip():
        raise HTTPException(status_code=422, detail="Title can't be empty")
    task = crud.create_task(db, task_in)
    day = crud.get_day(db, task.start_date)
    for t in day.tasks:
        if t.id == task.id:
            return t
    raise HTTPException(status_code=500, detail="Task created but not found")


@app.delete("/api/tasks/{task_id}")
def delete_task(task_id: int, db: Session = Depends(get_db)):
    ok = crud.delete_task(db, task_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"ok": True}


@app.post("/api/tasks/{task_id}/archive")
def archive_task(task_id: int, on: Optional[date] = None, db: Session = Depends(get_db)):
    """Stop a permanent task from `on` onwards (default today); earlier days keep their history."""
    task = crud.archive_task(db, task_id, on or date.today())
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"ok": True}


@app.get("/api/days/{target_date}", response_model=schemas.DayTasks)
def get_day(target_date: date, db: Session = Depends(get_db)):
    return crud.get_day(db, target_date)


@app.post("/api/days/{target_date}/tasks/{task_id}/completion", response_model=schemas.TaskOut)
def set_completion(target_date: date, task_id: int, body: schemas.CompletionUpdate, db: Session = Depends(get_db)):
    # one day of slack because the server's clock (UTC on Render) can be behind the user's
    if target_date > date.today() + timedelta(days=1):
        raise HTTPException(status_code=400, detail="Can't complete a task in the future")
    task = db.get(models.Task, task_id)
    if task is None or not task.applies_to(target_date):
        raise HTTPException(status_code=404, detail="Task not found for this date")
    crud.set_completion(db, task_id, target_date, body.completed)
    day = crud.get_day(db, target_date)
    for t in day.tasks:
        if t.id == task_id:
            return t
    raise HTTPException(status_code=404, detail="Task not found for this date")


@app.get("/api/calendar", response_model=list[schemas.CalendarDay])
def get_calendar(start: date, end: date, db: Session = Depends(get_db)):
    if end < start:
        raise HTTPException(status_code=400, detail="end must be >= start")
    if (end - start).days > 400:
        raise HTTPException(status_code=400, detail="Range too large (max 400 days)")
    return crud.get_calendar_summary(db, start, end)


@app.get("/api/habits", response_model=list[schemas.HabitOut])
def get_habits(today: Optional[date] = None, db: Session = Depends(get_db)):
    return crud.get_habits(db, today or date.today())


@app.get("/api/stats", response_model=schemas.Stats)
def get_stats(today: Optional[date] = None, db: Session = Depends(get_db)):
    return crud.get_stats(db, today or date.today())


app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/")
def index():
    return FileResponse("static/index.html", headers={"Cache-Control": "no-cache"})
