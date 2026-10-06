from sqlalchemy import Column, Integer, String, Boolean, Date, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship

from .database import Base


class Task(Base):
    __tablename__ = "tasks"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False)
    is_permanent = Column(Boolean, nullable=False, default=False)
    # for one-off tasks: the single day this task belongs to
    specific_date = Column(Date, nullable=True)
    # for permanent tasks: the day they start appearing from
    start_date = Column(Date, nullable=False)
    archived = Column(Boolean, nullable=False, default=False)

    completions = relationship("Completion", back_populates="task", cascade="all, delete-orphan")


class Completion(Base):
    __tablename__ = "completions"
    __table_args__ = (UniqueConstraint("task_id", "date", name="uq_task_date"),)

    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(Integer, ForeignKey("tasks.id"), nullable=False)
    date = Column(Date, nullable=False, index=True)
    completed = Column(Boolean, nullable=False, default=False)

    task = relationship("Task", back_populates="completions")
