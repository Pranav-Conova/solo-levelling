from sqlalchemy import Column, Integer, String, Boolean, Date, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship

from .database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    # stored lowercase so "Jinwoo" and "jinwoo" are the same Player
    username = Column(String, nullable=False, unique=True, index=True)
    password_hash = Column(String, nullable=False)
    created_at = Column(DateTime, nullable=False)


class AuthSession(Base):
    __tablename__ = "sessions"

    id = Column(Integer, primary_key=True, index=True)
    # only a hash of the cookie value is stored, so a leaked database can't be used to log in
    token_hash = Column(String, nullable=False, unique=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    created_at = Column(DateTime, nullable=False)
    expires_at = Column(DateTime, nullable=False)


class Task(Base):
    __tablename__ = "tasks"

    id = Column(Integer, primary_key=True, index=True)
    # nullable only for rows created before accounts existed; the first account claims them
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    title = Column(String, nullable=False)
    is_permanent = Column(Boolean, nullable=False, default=False)
    # for one-off tasks: the single day this task belongs to
    specific_date = Column(Date, nullable=True)
    # for permanent tasks: the day they start appearing from
    start_date = Column(Date, nullable=False)
    archived = Column(Boolean, nullable=False, default=False)
    # for permanent tasks: first day they no longer appear (history before it is kept)
    archived_on = Column(Date, nullable=True)

    completions = relationship("Completion", back_populates="task", cascade="all, delete-orphan")

    def applies_to(self, day) -> bool:
        if self.is_permanent:
            return self.start_date <= day and (self.archived_on is None or day < self.archived_on)
        return self.specific_date == day


class Completion(Base):
    __tablename__ = "completions"
    __table_args__ = (UniqueConstraint("task_id", "date", name="uq_task_date"),)

    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(Integer, ForeignKey("tasks.id"), nullable=False)
    date = Column(Date, nullable=False, index=True)
    completed = Column(Boolean, nullable=False, default=False)

    task = relationship("Task", back_populates="completions")
