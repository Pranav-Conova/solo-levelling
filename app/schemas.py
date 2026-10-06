from datetime import date
from typing import Optional

from pydantic import BaseModel


class TaskCreate(BaseModel):
    title: str
    is_permanent: bool = False
    # only used when is_permanent is False; defaults to today on the server
    specific_date: Optional[date] = None


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
