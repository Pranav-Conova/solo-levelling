import os

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

# read a local .env file if there is one; real environment variables (e.g. on Render) win
load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./tracker.db")

# Render/Heroku-style postgres URLs sometimes start with postgres:// which
# SQLAlchemy's psycopg2 dialect no longer accepts.
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(DATABASE_URL, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
