from datetime import date
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator


# ---------- accounts ----------
class Credentials(BaseModel):
    username: str = Field(min_length=3, max_length=30, pattern=r"^[A-Za-z0-9_.-]+$")
    password: str = Field(min_length=8, max_length=128)

    @field_validator("username")
    @classmethod
    def lowercase(cls, v: str) -> str:
        return v.lower()


class LoginIn(BaseModel):
    # no format rules here: a wrong-shaped name should just fail to log in
    username: str = Field(max_length=64)
    password: str = Field(max_length=128)


class PasswordChange(BaseModel):
    current_password: str = Field(max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


class Me(BaseModel):
    authenticated: bool
    username: Optional[str] = None
    # lets the client decide between the awakening (sign-up) and the login screen
    registration_open: bool
    has_users: bool


class TaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    is_permanent: bool = False
    # only used when is_permanent is False; defaults to today on the server
    specific_date: Optional[date] = None
    # only used when is_permanent is True; lets the client send its local "today"
    start_date: Optional[date] = None
    # only used when is_permanent is True: 1 = every day, 2 = every other day, ...
    interval_days: int = Field(default=1, ge=1, le=365)


class TaskOut(BaseModel):
    id: int
    title: str
    is_permanent: bool
    specific_date: Optional[date]
    start_date: date
    completed: bool
    interval_days: int = 1

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
    interval_days: int
    due_today: bool
    completed_today: bool
    # scheduled runs completed in a row (for every-N-day quests, off days don't break it)
    streak: int
    total_done: int
    next_due: date


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


# ---------- job applications ----------
ApplicationStatus = Literal["applied", "interviewing", "offer", "rejected", "withdrawn"]


class ApplicationIn(BaseModel):
    company: str = Field(min_length=1, max_length=80)
    role: str = Field(min_length=1, max_length=80)
    status: ApplicationStatus = "applied"
    applied_via: Optional[str] = Field(default=None, max_length=60)
    applied_on: Optional[date] = None

    @field_validator("company", "role")
    @classmethod
    def not_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("can't be empty")
        return v


class ApplicationPatch(BaseModel):
    company: Optional[str] = Field(default=None, min_length=1, max_length=80)
    role: Optional[str] = Field(default=None, min_length=1, max_length=80)
    status: Optional[ApplicationStatus] = None
    applied_via: Optional[str] = Field(default=None, max_length=60)
    applied_on: Optional[date] = None

    @field_validator("company", "role")
    @classmethod
    def not_blank(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.strip()
        if not v:
            raise ValueError("can't be empty")
        return v


class ApplicationOut(BaseModel):
    id: int
    company: str
    role: str
    status: ApplicationStatus
    applied_via: Optional[str]
    applied_on: date

    class Config:
        from_attributes = True
