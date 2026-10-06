from datetime import date

from fastapi import FastAPI, Depends, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from . import crud, models, schemas
from .database import Base, engine, get_db

Base.metadata.create_all(bind=engine)

app = FastAPI(title="Self Improvement Tracker")


@app.post("/api/tasks", response_model=schemas.TaskOut)
def create_task(task_in: schemas.TaskCreate, db: Session = Depends(get_db)):
    task = crud.create_task(db, task_in)
    day = crud.get_day(db, task.specific_date or date.today())
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
def archive_task(task_id: int, db: Session = Depends(get_db)):
    task = crud.archive_task(db, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"ok": True}


@app.get("/api/days/{target_date}", response_model=schemas.DayTasks)
def get_day(target_date: date, db: Session = Depends(get_db)):
    return crud.get_day(db, target_date)


@app.post("/api/days/{target_date}/tasks/{task_id}/completion", response_model=schemas.TaskOut)
def set_completion(target_date: date, task_id: int, body: schemas.CompletionUpdate, db: Session = Depends(get_db)):
    task = db.get(models.Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
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
    return crud.get_calendar_summary(db, start, end)


app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/")
def index():
    return FileResponse("static/index.html")
