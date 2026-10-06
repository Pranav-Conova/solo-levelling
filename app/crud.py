from datetime import date

from sqlalchemy import or_
from sqlalchemy.orm import Session

from . import models, schemas


def create_task(db: Session, task_in: schemas.TaskCreate) -> models.Task:
    today = date.today()
    if task_in.is_permanent:
        task = models.Task(
            title=task_in.title,
            is_permanent=True,
            specific_date=None,
            start_date=today,
        )
    else:
        target_date = task_in.specific_date or today
        task = models.Task(
            title=task_in.title,
            is_permanent=False,
            specific_date=target_date,
            start_date=target_date,
        )
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


def archive_task(db: Session, task_id: int) -> models.Task | None:
    task = db.get(models.Task, task_id)
    if task is None:
        return None
    task.archived = True
    db.commit()
    db.refresh(task)
    return task


def delete_task(db: Session, task_id: int) -> bool:
    task = db.get(models.Task, task_id)
    if task is None:
        return False
    db.delete(task)
    db.commit()
    return True


def _tasks_for_date(db: Session, target_date: date) -> list[models.Task]:
    return (
        db.query(models.Task)
        .filter(
            models.Task.archived == False,  # noqa: E712
            or_(
                models.Task.specific_date == target_date,
                (models.Task.is_permanent == True) & (models.Task.start_date <= target_date),  # noqa: E712
            ),
        )
        .order_by(models.Task.is_permanent.desc(), models.Task.id)
        .all()
    )


def get_day(db: Session, target_date: date) -> schemas.DayTasks:
    tasks = _tasks_for_date(db, target_date)
    task_ids = [t.id for t in tasks]
    completions = (
        db.query(models.Completion)
        .filter(models.Completion.date == target_date, models.Completion.task_id.in_(task_ids))
        .all()
        if task_ids
        else []
    )
    completed_ids = {c.task_id for c in completions if c.completed}

    out_tasks = [
        schemas.TaskOut(
            id=t.id,
            title=t.title,
            is_permanent=t.is_permanent,
            specific_date=t.specific_date,
            start_date=t.start_date,
            completed=t.id in completed_ids,
        )
        for t in tasks
    ]
    done = len(completed_ids)
    return schemas.DayTasks(date=target_date, tasks=out_tasks, total=len(out_tasks), done=done)


def set_completion(db: Session, task_id: int, target_date: date, completed: bool) -> models.Completion:
    completion = (
        db.query(models.Completion)
        .filter(models.Completion.task_id == task_id, models.Completion.date == target_date)
        .first()
    )
    if completion is None:
        completion = models.Completion(task_id=task_id, date=target_date, completed=completed)
        db.add(completion)
    else:
        completion.completed = completed
    db.commit()
    db.refresh(completion)
    return completion


def get_calendar_summary(db: Session, start: date, end: date) -> list[schemas.CalendarDay]:
    all_tasks = (
        db.query(models.Task)
        .filter(
            models.Task.archived == False,  # noqa: E712
            or_(
                (models.Task.specific_date >= start) & (models.Task.specific_date <= end),
                (models.Task.is_permanent == True) & (models.Task.start_date <= end),  # noqa: E712
            ),
        )
        .all()
    )
    completions = (
        db.query(models.Completion)
        .filter(models.Completion.date >= start, models.Completion.date <= end, models.Completion.completed == True)  # noqa: E712
        .all()
    )
    completed_pairs = {(c.task_id, c.date) for c in completions}

    results = []
    cursor = start
    while cursor <= end:
        total = 0
        done = 0
        for t in all_tasks:
            applies = (t.is_permanent and t.start_date <= cursor) or (
                not t.is_permanent and t.specific_date == cursor
            )
            if applies:
                total += 1
                if (t.id, cursor) in completed_pairs:
                    done += 1
        results.append(schemas.CalendarDay(date=cursor, total=total, done=done))
        cursor = cursor.fromordinal(cursor.toordinal() + 1)
    return results
