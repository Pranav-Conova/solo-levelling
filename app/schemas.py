from datetime import date
from typing import Optional

from pydantic import BaseModel, Field


class TaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    is_permanent: bool = False
    # only used when is_permanent is False; defaults to today on the server
    specific_date: Optional[date] = None
    # only used when is_permanent is True; lets the client send its local "today"
    start_date: Optional[date] = None


class TaskOut(BaseModel):
    id: int
    title: str
    is_permanent: bool
    specific_date: Optional[date]
    start_date: date
    completed: bool

    class Config:
        from_attributes = True


class CompletionUpdate(BaseModel):
    completed: bool


class DayTasks(BaseModel):
    date: date
    tasks: list[TaskOut]
    total: int
    done: int


class CalendarDay(BaseModel):
    date: date
    total: int
    done: int


class HabitOut(BaseModel):
    id: int
    title: str
    start_date: date
    completed_today: bool
    streak: int
    total_done: int


class Stats(BaseModel):
    total_done: int
    current_streak: int
    best_streak: int
    active_days: int
    perfect_days: int
    xp: int
    level: int
    level_start_xp: int
    next_level_xp: int
    rank: str
