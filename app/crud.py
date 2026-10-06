from datetime import date, timedelta

from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from . import models, schemas

XP_PER_TASK = 10
XP_PER_PERFECT_DAY = 20
RANKS = [(30, "S"), (20, "A"), (15, "B"), (10, "C"), (5, "D"), (1, "E")]

# Every function below is scoped to one user: a Player can only ever see or change their own quests.


def get_owned_task(db: Session, task_id: int, user_id: int) -> models.Task | None:
    task = db.get(models.Task, task_id)
    return task if task is not None and task.user_id == user_id else None


def create_task(db: Session, task_in: schemas.TaskCreate, user_id: int) -> models.Task:
    today = date.today()
    title = task_in.title.strip()
    if task_in.is_permanent:
        task = models.Task(
            user_id=user_id,
            title=title,
            is_permanent=True,
            specific_date=None,
            start_date=task_in.start_date or today,
        )
    else:
        target_date = task_in.specific_date or today
        task = models.Task(
            user_id=user_id,
            title=title,
            is_permanent=False,
            specific_date=target_date,
            start_date=target_date,
        )
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


def archive_task(db: Session, task_id: int, on: date, user_id: int) -> models.Task | None:
    task = get_owned_task(db, task_id, user_id)
    if task is None:
        return None
    task.archived = True
    task.archived_on = max(on, task.start_date)
    db.commit()
    db.refresh(task)
    return task


def delete_task(db: Session, task_id: int, user_id: int) -> bool:
    task = get_owned_task(db, task_id, user_id)
    if task is None:
        return False
    db.delete(task)
    db.commit()
    return True


def _permanent_active_between(start: date, end: date):
    """Permanent tasks that appear on at least one day in [start, end]."""
    return and_(
        models.Task.is_permanent == True,  # noqa: E712
        models.Task.start_date <= end,
        or_(models.Task.archived_on == None, models.Task.archived_on > start),  # noqa: E711
    )


def _tasks_for_date(db: Session, target_date: date, user_id: int) -> list[models.Task]:
    return (
        db.query(models.Task)
        .filter(
            models.Task.user_id == user_id,
            or_(
                models.Task.specific_date == target_date,
                _permanent_active_between(target_date, target_date),
            ),
        )
        .order_by(models.Task.is_permanent.desc(), models.Task.id)
        .all()
    )


def get_day(db: Session, target_date: date, user_id: int) -> schemas.DayTasks:
    tasks = _tasks_for_date(db, target_date, user_id)
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
    """Callers must check ownership first (see get_owned_task)."""
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


def get_calendar_summary(db: Session, start: date, end: date, user_id: int) -> list[schemas.CalendarDay]:
    all_tasks = (
        db.query(models.Task)
        .filter(
            models.Task.user_id == user_id,
            or_(
                and_(models.Task.specific_date >= start, models.Task.specific_date <= end),
                _permanent_active_between(start, end),
            ),
        )
        .all()
    )
    task_ids = [t.id for t in all_tasks]
    completions = (
        db.query(models.Completion)
        .filter(
            models.Completion.task_id.in_(task_ids),
            models.Completion.date >= start,
            models.Completion.date <= end,
            models.Completion.completed == True,  # noqa: E712
        )
        .all()
        if task_ids
        else []
    )
    completed_pairs = {(c.task_id, c.date) for c in completions}

    results = []
    cursor = start
    while cursor <= end:
        total = 0
        done = 0
        for t in all_tasks:
            if t.applies_to(cursor):
                total += 1
                if (t.id, cursor) in completed_pairs:
                    done += 1
        results.append(schemas.CalendarDay(date=cursor, total=total, done=done))
        cursor += timedelta(days=1)
    return results


def _current_streak(is_active, today: date) -> int:
    """Consecutive active days ending today, or yesterday if today isn't active yet."""
    cursor = today if is_active(today) else today - timedelta(days=1)
    streak = 0
    while is_active(cursor):
        streak += 1
        cursor -= timedelta(days=1)
    return streak


def _level_for(xp: int) -> tuple[int, int, int]:
    """Level n starts at 50 * n * (n - 1) XP: 0, 100, 300, 600, 1000, ..."""
    level = 1
    while 50 * (level + 1) * level <= xp:
        level += 1
    return level, 50 * level * (level - 1), 50 * (level + 1) * level


def get_stats(db: Session, today: date, user_id: int) -> schemas.Stats:
    first_task = (
        db.query(models.Task).filter(models.Task.user_id == user_id).order_by(models.Task.start_date).first()
    )
    days = (
        get_calendar_summary(db, first_task.start_date, today, user_id)
        if first_task and first_task.start_date <= today
        else []
    )
    done_by_day = {d.date: d.done for d in days}

    total_done = sum(d.done for d in days)
    active_days = sum(1 for d in days if d.done > 0)
    perfect_days = sum(1 for d in days if d.total > 0 and d.done == d.total)

    best = run = 0
    for d in days:
        run = run + 1 if d.done > 0 else 0
        best = max(best, run)

    xp = total_done * XP_PER_TASK + perfect_days * XP_PER_PERFECT_DAY
    level, level_start_xp, next_level_xp = _level_for(xp)
    rank = next(r for min_level, r in RANKS if level >= min_level)

    return schemas.Stats(
        total_done=total_done,
        current_streak=_current_streak(lambda d: done_by_day.get(d, 0) > 0, today),
        best_streak=best,
        active_days=active_days,
        perfect_days=perfect_days,
        xp=xp,
        level=level,
        level_start_xp=level_start_xp,
        next_level_xp=next_level_xp,
        rank=rank,
    )


def get_habits(db: Session, today: date, user_id: int) -> list[schemas.HabitOut]:
    habits = (
        db.query(models.Task)
        .filter(
            models.Task.user_id == user_id,
            models.Task.is_permanent == True,  # noqa: E712
            models.Task.archived_on == None,  # noqa: E711
        )
        .order_by(models.Task.id)
        .all()
    )
    if not habits:
        return []
    completions = (
        db.query(models.Completion)
        .filter(
            models.Completion.task_id.in_([h.id for h in habits]),
            models.Completion.completed == True,  # noqa: E712
            models.Completion.date <= today,
        )
        .all()
    )
    done_pairs = {(c.task_id, c.date) for c in completions}

    return [
        schemas.HabitOut(
            id=h.id,
            title=h.title,
            start_date=h.start_date,
            completed_today=(h.id, today) in done_pairs,
            streak=_current_streak(lambda d, h=h: (h.id, d) in done_pairs, today),
            total_done=sum(1 for task_id, d in done_pairs if task_id == h.id and d >= h.start_date),
        )
        for h in habits
    ]


# ---------- accounts ----------
def create_user(db: Session, username: str, password_hash: str, now) -> models.User:
    first_user = db.query(models.User).first() is None
    user = models.User(username=username, password_hash=password_hash, created_at=now)
    db.add(user)
    db.flush()
    if first_user:
        # quests made before accounts existed belong to whoever sets the app up
        db.query(models.Task).filter(models.Task.user_id == None).update({"user_id": user.id})  # noqa: E711
    db.commit()
    db.refresh(user)
    return user
