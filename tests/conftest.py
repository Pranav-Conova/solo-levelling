import importlib
import os

import pytest


def make_app(db_path, **env):
    """Import a fresh copy of the app bound to its own SQLite file."""
    os.environ["DATABASE_URL"] = f"sqlite:///{db_path}"
    for k, v in env.items():
        os.environ[k] = v
    import app.database, app.models, app.auth, app.crud, app.main  # noqa: E401
    for mod in (app.database, app.models, app.auth, app.crud, app.main):
        importlib.reload(mod)
    for k in env:
        del os.environ[k]
    return app.main.app


@pytest.fixture
def db_path(tmp_path):
    yield str(tmp_path / "test.db")
    import app.database
    app.database.engine.dispose()  # release the SQLite file (Windows won't delete open files)
